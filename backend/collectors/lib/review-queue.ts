// Cola de revisión (match_reviews): listar y decidir. Aceptar aplica la vinculación; rechazar la descarta.
// Al aceptar un candidato, los demás candidatos pendientes del mismo registro se rechazan.
import type { Db } from "./db.ts";
import { publish } from "../feeds/run.ts";
import { classifyArticle } from "../feeds/match.ts";
import type { FeedItem } from "../feeds/parse.ts";

export interface PendingReview { id: string; entity_type: string; entity_id: string | null; provider: string; candidate_id: string | null; candidate_label: string | null; method: string; score: number | null; evidence: Record<string, unknown>; subject: string | null }

export async function listPending(db: Db): Promise<PendingReview[]> {
  const { rows } = await db.query<PendingReview>(`
    select m.id::text, m.entity_type, m.entity_id::text, m.provider, m.candidate_id, m.candidate_label, m.method, m.score::float8 as score, m.evidence,
      case m.entity_type
        when 'film' then (select f.title || coalesce(' (' || f.year || ')', '') from films f where f.id = m.entity_id)
        when 'feed_item' then (select r.payload ->> 'title' from source_records r where r.id = m.entity_id)
      end as subject
    from match_reviews m where m.status = 'pending' order by m.entity_type, subject, m.score desc nulls last`);
  return rows;
}

async function close(db: Db, id: string, status: "accepted" | "rejected", siblingsToo: boolean) {
  const { rows: [m] } = await db.query<{ entity_type: string; entity_id: string; provider: string }>(
    "update match_reviews set status = $2, decided_at = now(), updated_at = now() where id = $1 returning entity_type, entity_id::text, provider", [id, status]);
  if (siblingsToo) {
    await db.query(`update match_reviews set status = 'rejected', decided_at = now(), updated_at = now(),
        evidence = evidence || '{"motivo_rechazo": "Se aceptó otro candidato"}'::jsonb
      where entity_type = $1 and entity_id = $2 and provider = $3 and status = 'pending' and id <> $4`, [m.entity_type, m.entity_id, m.provider, id]);
  }
}

export async function decide(db: Db, id: string, decision: "aceptar" | "rechazar"): Promise<string> {
  const { rows: [m] } = await db.query<{ entity_type: string; entity_id: string; provider: string; candidate_id: string | null; status: string; evidence: Record<string, unknown> }>(
    "select entity_type, entity_id::text, provider, candidate_id, status, evidence from match_reviews where id = $1", [id]);
  if (!m) throw new Error(`No existe la revisión ${id}.`);
  if (m.status !== "pending") throw new Error(`La revisión ${id} ya está en estado ${m.status}.`);
  if (decision === "rechazar") { await close(db, id, "rejected", false); return "rechazada"; }
  if (!m.candidate_id) throw new Error("La revisión no tiene candidato que aceptar.");

  if (m.entity_type === "film" && m.provider === "tmdb") {
    const { rows: owner } = await db.query<{ film_id: string }>("select film_id::text from film_external_ids where provider = 'tmdb' and external_id = $1", [m.candidate_id]);
    if (owner.length && owner[0].film_id !== m.entity_id) throw new Error(`El id de TMDB ${m.candidate_id} ya pertenece a otra película (${owner[0].film_id}): posible duplicado, resuélvelo antes.`);
    await db.query("insert into film_external_ids (film_id, provider, external_id, source_id) values ($1, 'tmdb', $2, 'editorial') on conflict do nothing", [m.entity_id, m.candidate_id]);
    await close(db, id, "accepted", true);
    return "aceptada: id de TMDB vinculado (el siguiente collect:tmdb trae póster y datos)";
  }
  if (m.entity_type === "feed_item") {
    const { rows: [rec] } = await db.query<{ payload: FeedItem; entity_id: string | null; source_id: string }>(
      "select payload, entity_id::text, source_id from source_records where id = $1", [m.entity_id]);
    const { rows: [src] } = await db.query<{ id: string; name: string; feed_kind: "reviews" | "news" | "mixed" }>(
      "select id, name, coalesce(feed_kind, 'mixed') as feed_kind from sources where id = $1", [rec.source_id]);
    const kind = m.evidence.tipo === "review" || m.evidence.tipo === "news" ? m.evidence.tipo : classifyArticle(rec.payload, src.feed_kind);
    if (kind === "news" && rec.entity_id) {
      await db.query("update news_items set film_id = $2, verification = 'editorial' where id = $1", [rec.entity_id, m.candidate_id]);
    } else {
      const created = await publish(db, { ...src, feed_url: "", feed_scope: "general" }, rec.payload, kind, m.candidate_id, "editorial");
      if (created) await db.query("update source_records set entity_id = $2 where id = $1", [m.entity_id, created]);
    }
    await close(db, id, "accepted", true);
    return `aceptada: ${kind === "review" ? "crítica" : "noticia"} vinculada a la película`;
  }
  throw new Error(`No sé aplicar revisiones de tipo ${m.entity_type}/${m.provider}.`);
}
