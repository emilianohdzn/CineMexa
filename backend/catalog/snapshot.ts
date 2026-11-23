// Arma la respuesta CatalogSnapshot (contrato v1, snake_case) a partir de las filas.
// Función pura: misma entrada, misma salida. La comparte la Edge Function `catalog`.
import { classifyFilmStatus } from "../../packages/core/src/availability.ts";
import type { CatalogRows } from "./queries.ts";

type Row = Record<string, any>;
type Json = Record<string, unknown>;

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function provenance(source: string, sourceUrl: string | null, retrievedAt: unknown, verification: string, extra: Json = {}): Json {
  return { source, source_url: sourceUrl ?? null, retrieved_at: iso(retrievedAt), published_at: null, verification, confidence: null, ...extra };
}

const groupBy = <T extends Row>(rows: T[], key: string) => {
  const map = new Map<string, T[]>();
  for (const r of rows) { const k = r[key]; if (!map.has(k)) map.set(k, []); map.get(k)!.push(r); }
  return map;
};

const EVENT_TIMELINE: Record<string, { kind: string; label: (fest: string, e: Row) => string }> = {
  selection: { kind: "festival_selection", label: (f, e) => `Selección${e.section ? ` · ${e.section}` : ""} · ${f}` },
  screening: { kind: "festival_screening", label: (f) => `Función · ${f}` },
  premiere: { kind: "premiere", label: (f) => `Estreno · ${f}` },
  award: { kind: "award", label: (f, e) => `${e.award_name} · ${f}` },
};

export function buildSnapshot(rows: CatalogRows, now: Date): Json {
  // Festivales sin sede con coordenadas no entran (el mapa las necesita); sus eventos tampoco.
  const festivals = new Map(rows.festivals.map((f) => [f.id, f]));
  const editionsByFestival = groupBy(rows.editions.filter((e) => festivals.has(e.festival_id)), "festival_id");
  const filmIds = new Set(rows.films.map((f) => f.id));
  const events = rows.events.filter((e) => filmIds.has(e.film_id) && festivals.has(e.festival_id));
  const screenings = rows.screenings.filter((s) => filmIds.has(s.film_id));

  const credits = groupBy(rows.credits, "film_id");
  const titles = groupBy(rows.titles, "film_id");
  const ids = groupBy(rows.externalIds, "film_id");
  const images = groupBy(rows.images, "film_id");
  const screeningsByFilm = groupBy(screenings, "film_id");
  const eventsByFilm = groupBy(events, "film_id");

  const films = rows.films.map((f) => {
    const people = (role: string) => (credits.get(f.id) ?? []).filter((c) => c.role === role).map((c) => c.name);
    const image = (kind: string) => {
      const i = (images.get(f.id) ?? []).find((x) => x.kind === kind);
      return i ? { url: i.url, width: num(i.width), height: num(i.height), source: i.source_id, attribution: i.attribution ?? null } : null;
    };
    const filmIds = ids.get(f.id) ?? [];
    const canonical = filmIds.find((x) => x.is_canonical) ?? filmIds[0];
    const sourceUrl = canonical?.provider === "wikidata" ? `https://www.wikidata.org/wiki/${canonical.external_id}`
      : canonical?.provider === "tmdb" ? `https://www.themoviedb.org/movie/${canonical.external_id}` : null;
    const status = classifyFilmStatus({
      now,
      year: num(f.year),
      mxReleaseDate: f.mx_release_date,
      confirmedScreenings: (screeningsByFilm.get(f.id) ?? []).map((s) => ({ startsAt: iso(s.starts_at)! })),
      festivalEvents: (eventsByFilm.get(f.id) ?? []).filter((e) => e.occurs_at).map((e) => ({ date: iso(e.occurs_at)! })),
    });
    return {
      id: f.id, slug: f.slug, title: f.title, original_title: f.original_title ?? null,
      alt_titles: (titles.get(f.id) ?? []).map((t) => t.title).filter((t) => t !== f.title && t !== f.original_title),
      year: num(f.year), kind: f.kind, runtime_minutes: num(f.runtime_minutes), countries: f.countries ?? [],
      mx_participation: f.mx_participation, genres: f.genres ?? [], is_documentary: f.is_documentary, is_animation: f.is_animation,
      synopsis: f.synopsis ?? null, poster: image("poster"), backdrop: image("backdrop"),
      directors: people("director"), writers: people("writer"), cinematographers: people("cinematographer"), cast: people("cast"),
      trailer_url: f.trailer_url ?? null, status, mx_release_date: f.mx_release_date ?? null,
      provenance: provenance(canonical?.source_id ?? "editorial", sourceUrl, f.updated_at, f.verification),
    };
  });

  const timeline: Json[] = [];
  for (const e of events) {
    const date = e.occurs_at ?? e.announced_at;
    const spec = EVENT_TIMELINE[e.kind];
    if (!date || !spec) continue;
    const fest = festivals.get(e.festival_id)!;
    timeline.push({
      id: `ev-${e.id}`, film_id: e.film_id, kind: spec.kind, date: iso(date), label: spec.label(fest.short_name ?? fest.name, e),
      place: `${fest.city}, ${fest.country}`,
      provenance: provenance(e.source_id, e.source_url, e.retrieved_at, e.verification, { confidence: num(e.confidence) }),
    });
  }
  for (const f of rows.films) {
    if (!f.mx_release_date) continue;
    timeline.push({
      id: `rel-${f.id}`, film_id: f.id, kind: "theatrical_release",
      // Fecha de calendario en México: medianoche de la Ciudad de México (UTC−6).
      date: `${f.mx_release_date}T06:00:00.000Z`, label: "Estreno identificado en México", place: "México",
      provenance: provenance("editorial", null, f.updated_at, f.verification),
    });
  }
  timeline.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Defensa ante jsonb guardado como texto (doble serialización): se lee igual.
  const asArray = (v: unknown): Row[] => (typeof v === "string" ? JSON.parse(v) : (v as Row[]) ?? []);
  for (const t of rows.trends) t.entries = asArray(t.entries);
  const trendsByWindow = groupBy(rows.trends, "window_key");
  const trends = ["24h", "7d", "30d"].flatMap((w) => {
    const list = trendsByWindow.get(w) ?? [];
    const latest = list[0];
    if (!latest) return [];
    return [{
      window: w, computed_at: iso(latest.computed_at), label: latest.label, sources_used: latest.sources_used,
      methodology_version: latest.methodology_version, is_demo: false,
      entries: (latest.entries as Row[]).filter((e) => filmIds.has(e.filmId)).map((e) => ({
        film_id: e.filmId, rank: e.rank, previous_rank: e.previousRank ?? null, score: e.score, explanation: e.explanation,
        signals: (e.signals ?? []).map((s: Row) => ({ source: s.source, metric: s.metric, current: s.current, baseline: s.baseline, growth_pct: s.growthPct ?? null })),
      })),
      history: list.slice().reverse().flatMap((snap) => (snap.entries as Row[]).filter((e) => filmIds.has(e.filmId))
        .map((e) => ({ date: iso(snap.computed_at), film_id: e.filmId, score: e.score }))),
    }];
  });

  return {
    meta: {
      mode: "live", api_version: "1", generated_at: now.toISOString(), notice: null,
      sources: rows.sources.map((s) => ({ id: s.id, name: s.name, attribution: s.attribution ?? null, last_sync_at: iso(s.last_sync_at), status: s.status })),
    },
    films,
    screenings: screenings.map((s) => ({
      id: s.id, film_id: s.film_id,
      venue: { name: s.venue_name, city: s.city, country: s.country, latitude: s.latitude, longitude: s.longitude, coordinate_precision: s.coordinate_precision },
      kind: s.kind, starts_at: iso(s.starts_at), ticket_url: s.ticket_url ?? null,
      provenance: provenance(s.source_id, s.source_url, s.retrieved_at, s.verification),
    })),
    streaming: rows.streaming.filter((o) => filmIds.has(o.film_id)).map((o) => ({
      film_id: o.film_id, provider: o.provider, offer_type: o.offer_type, url: o.url ?? null,
      provenance: provenance(o.source_id, o.url, o.retrieved_at, "automatic"),
    })),
    reviews: rows.reviews.filter((r) => filmIds.has(r.film_id)).map((r) => ({
      id: r.id, film_id: r.film_id, outlet: r.outlet, critic_name: r.critic_name ?? null, title: r.title, url: r.url,
      published_at: iso(r.published_at), score: num(r.score), score_scale: num(r.score_scale), excerpt: r.excerpt ?? null,
      is_automated_summary: r.is_automated_summary,
      provenance: provenance(r.source_id, r.url, r.retrieved_at, r.verification, { published_at: iso(r.published_at) }),
    })),
    timeline,
    festivals: [...festivals.values()].map((f) => ({
      id: f.id, slug: f.slug, name: f.name, short_name: f.short_name ?? null, city: f.city, country: f.country,
      website_url: f.website_url ?? null, focus: f.focus ?? [],
      venue: { name: f.venue_name, city: f.venue_city, country: f.venue_country, latitude: f.latitude, longitude: f.longitude, coordinate_precision: f.coordinate_precision },
      editions: (editionsByFestival.get(f.id) ?? []).map((e) => ({
        id: e.id, label: e.edition_label, year: num(e.year), starts_on: e.starts_on ?? null, ends_on: e.ends_on ?? null,
        timezone: e.timezone, program_url: e.program_url ?? null, call_url: e.call_url ?? null, call_deadline: iso(e.call_deadline),
        is_cancelled: e.is_cancelled, provenance: provenance(e.source_id, e.source_url, e.retrieved_at, e.verification),
      })),
      provenance: provenance("editorial", f.website_url ?? null, f.updated_at, "editorial"),
    })),
    festival_events: events.map((e) => ({
      id: e.id, edition_id: e.edition_id, festival_id: e.festival_id, film_id: e.film_id, kind: e.kind,
      section: e.section ?? null, award_name: e.award_name ?? null, occurs_at: iso(e.occurs_at), announced_at: iso(e.announced_at),
      provenance: provenance(e.source_id, e.source_url, e.retrieved_at, e.verification, { confidence: num(e.confidence) }),
    })),
    news: rows.news.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, url: n.url, outlet: n.outlet ?? null, published_at: iso(n.published_at),
      film_id: n.film_id && filmIds.has(n.film_id) ? n.film_id : null, festival_id: n.festival_id && festivals.has(n.festival_id) ? n.festival_id : null,
      provenance: provenance(n.source_id, n.url, n.retrieved_at, n.verification, { published_at: iso(n.published_at) }),
    })),
    trends,
  };
}
