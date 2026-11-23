// Collector de crítica y noticias desde feeds RSS/Atom de medios activados a mano en `sources`
// (kind = 'feed', enabled = true, feed_url). Sólo guarda título, autor, medio, fecha y enlace al original.
// - Crítica: se publica sólo vinculada con evidencia a una película del catálogo; si es ambigua, va a revisión.
// - Noticias: igual; de un medio dedicado al cine mexicano (feed_scope = 'mx') se conserva también sin película.
// Uso: node collectors/feeds/run.ts
import { fileURLToPath } from "node:url";
import { fetchText, type FetchOptions } from "../lib/http.ts";
import { openPostgres, type Db } from "../lib/db.ts";
import { finishRun, linkSourceRecord, recordSource, startRun, type RunStatus } from "../lib/runs.ts";
import { parseFeed, type FeedItem } from "./parse.ts";
import { classifyArticle, filmKey, matchArticle, newsKind, type FilmKey } from "./match.ts";

interface FeedSource { id: string; name: string; feed_url: string; feed_kind: "reviews" | "news" | "mixed"; feed_scope: "mx" | "general" }

export interface FeedRunOptions { userAgent: string; now?: Date; maxAgeDays?: number; http?: Omit<FetchOptions, "headers"> }

export async function loadFilmKeys(db: Db): Promise<FilmKey[]> {
  const { rows } = await db.query<{ id: string; title: string; original_title: string | null; year: number | null; directors: string[] }>(`
    select f.id::text, f.title, f.original_title, f.year,
      coalesce((select array_agg(p.name) from film_credits c join people p on p.id = c.person_id where c.film_id = f.id and c.role = 'director'), '{}') as directors
    from films f where f.published and f.merged_into is null`);
  return rows.map(filmKey);
}

export async function publish(db: Db, src: FeedSource, item: FeedItem, kind: "review" | "news", filmId: string | null, verification: string) {
  if (kind === "review") {
    const { rows } = await db.query<{ id: string }>(`
      insert into reviews (film_id, outlet, critic_name, title, url, published_at, source_id, verification)
      values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (url) do nothing returning id::text`,
      [filmId, src.name, item.author, item.title, item.url, item.publishedAt, src.id, verification]);
    return rows[0]?.id ?? null;
  }
  const { rows } = await db.query<{ id: string }>(`
    insert into news_items (kind, title, url, outlet, author, published_at, film_id, source_id, verification)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (url) do nothing returning id::text`,
    [newsKind(item.title), item.title, item.url, src.name, item.author, item.publishedAt, filmId, src.id, verification]);
  return rows[0]?.id ?? null;
}

async function review(db: Db, recordId: string, src: FeedSource, film: FilmKey, status: string, score: number, evidence: Record<string, unknown>) {
  await db.query(`
    insert into match_reviews (entity_type, entity_id, provider, candidate_id, candidate_label, method, status, score, evidence)
    values ('feed_item', $1, $2, $3, $4, 'feed_title_evidence', $5, $6, $7)
    on conflict (entity_type, entity_id, provider, candidate_id) do update
      set evidence = excluded.evidence, score = excluded.score, updated_at = now(),
          status = case when match_reviews.status in ('accepted', 'rejected') then match_reviews.status else excluded.status end`,
    [recordId, src.id, film.id, `${film.title}${film.year ? ` (${film.year})` : ""}`, status, score, JSON.stringify(evidence)]);
}

export async function runFeeds(db: Db, opts: FeedRunOptions) {
  if (!opts.userAgent || /definir/i.test(opts.userAgent)) throw new Error("WIKIDATA_USER_AGENT (o FEEDS_USER_AGENT) debe identificar el proyecto y un contacto.");
  const { now = new Date(), maxAgeDays = 180, http = {} } = opts;
  const { rows: sources } = await db.query<FeedSource>(
    "select id, name, feed_url, coalesce(feed_kind, 'mixed') as feed_kind, coalesce(feed_scope, 'general') as feed_scope from sources where kind = 'feed' and enabled and feed_url is not null order by id");
  const counts = { feeds: sources.length, items: 0, unchanged: 0, reviews: 0, news: 0, pending: 0, discarded: 0, old: 0 };
  const errors: string[] = [];
  if (sources.length === 0) return { status: "succeeded" as RunStatus, counts, errors };
  const films = await loadFilmKeys(db);
  const oldest = now.getTime() - maxAgeDays * 86_400_000;

  for (const src of sources) {
    const runId = await startRun(db, src.id, "feed_articles", { feed: src.feed_url });
    const before = { ...counts };
    let failed: string | null = null;
    try {
      const items = parseFeed(await fetchText(src.feed_url, { ...http, headers: { "User-Agent": opts.userAgent, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" } }));
      for (const item of items) {
        counts.items++;
        const t = Date.parse(item.publishedAt);
        if (t < oldest || t > now.getTime() + 86_400_000) { counts.old++; continue; }
        const { changed } = await recordSource(db, { sourceId: src.id, entityType: "feed_item", externalId: item.url, sourceUrl: item.url, payload: item, runId });
        if (!changed) { counts.unchanged++; continue; }
        const { rows: [rec] } = await db.query<{ id: string }>(
          "select id::text from source_records where source_id = $1 and entity_type = 'feed_item' and external_id = $2", [src.id, item.url]);
        const kind = classifyArticle(item, src.feed_kind);
        const m = matchArticle(item, films);
        if (m.kind === "linked") {
          const id = await publish(db, src, item, kind, m.film.id, "automatic");
          if (id) await linkSourceRecord(db, src.id, "feed_item", item.url, id);
          await review(db, rec.id, src, m.film, "auto_matched", 1, { evidencia: m.evidence, titular: item.title });
          counts[kind === "review" ? "reviews" : "news"]++;
        } else if (m.kind === "ambiguous") {
          for (const c of m.candidates) await review(db, rec.id, src, c.film, "pending", c.evidence.length ? 0.6 : 0.4, { evidencia: c.evidence, motivo: c.motivo, titular: item.title, tipo: kind });
          counts.pending++;
          // Una noticia de un medio de cine mexicano se publica sin película mientras se decide.
          if (kind === "news" && src.feed_scope === "mx") {
            const id = await publish(db, src, item, "news", null, "automatic");
            if (id) { await linkSourceRecord(db, src.id, "feed_item", item.url, id); counts.news++; }
          }
        } else if (kind === "news" && src.feed_scope === "mx") {
          const id = await publish(db, src, item, "news", null, "automatic");
          if (id) { await linkSourceRecord(db, src.id, "feed_item", item.url, id); counts.news++; }
        } else {
          counts.discarded++;
        }
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
      errors.push(`${src.id}: ${failed}`);
    }
    const delta = (k: keyof typeof counts) => counts[k] - before[k];
    await finishRun(db, runId, {
      status: failed ? "failed" : "succeeded", seen: delta("items"), upserted: delta("reviews") + delta("news"),
      error: failed, meta: { reviews: delta("reviews"), news: delta("news"), pending: delta("pending"), discarded: delta("discarded") },
    });
  }
  const status: RunStatus = errors.length === 0 ? "succeeded" : errors.length < sources.length ? "partial" : "failed";
  return { status, counts, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
  const { db, end } = await openPostgres(url);
  console.log(JSON.stringify(await runFeeds(db, { userAgent: process.env.FEEDS_USER_AGENT ?? process.env.WIKIDATA_USER_AGENT ?? "" }), null, 2));
  await end();
}
