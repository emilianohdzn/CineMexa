// Registro de corridas en ingestion_runs y de registros crudos en source_records.
import { createHash } from "node:crypto";
import type { Db } from "./db.ts";

export type RunStatus = "succeeded" | "partial" | "failed";

export async function startRun(db: Db, sourceId: string, job: string, meta: Record<string, unknown> = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into ingestion_runs (source_id, job, meta) values ($1, $2, $3) returning id",
    [sourceId, job, JSON.stringify(meta)],
  );
  return rows[0].id;
}

export async function finishRun(
  db: Db,
  runId: string,
  result: { status: RunStatus; seen: number; upserted: number; error?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `update ingestion_runs set status = $2, finished_at = now(), records_seen = $3, records_upserted = $4,
       error = $5, meta = meta || $6::jsonb where id = $1`,
    [runId, result.status, result.seen, result.upserted, result.error ?? null, JSON.stringify(result.meta ?? {})],
  );
  // Una corrida que funcionó demuestra que la fuente está configurada: se marca habilitada.
  if (result.status !== "failed") {
    await db.query(
      "update sources set enabled = true where not enabled and id = (select source_id from ingestion_runs where id = $1)", [runId]);
  }
}

/** Hash estable del contenido (claves ordenadas) para detectar cambios entre consultas. */
export function payloadHash(payload: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
    : v;
  return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}

/**
 * Guarda el registro crudo. Devuelve si cambió respecto a la última consulta
 * (nuevo o con hash distinto) y la entidad a la que ya estaba resuelto.
 */
export async function recordSource(
  db: Db,
  rec: { sourceId: string; entityType: string; externalId: string; sourceUrl: string | null; payload: unknown; runId: string },
): Promise<{ changed: boolean; entityId: string | null }> {
  const hash = payloadHash(rec.payload);
  const { rows: prev } = await db.query<{ payload_hash: string; entity_id: string | null }>(
    "select payload_hash, entity_id from source_records where source_id = $1 and entity_type = $2 and external_id = $3",
    [rec.sourceId, rec.entityType, rec.externalId],
  );
  await db.query(
    `insert into source_records (source_id, external_id, entity_type, source_url, payload, payload_hash, last_run_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (source_id, entity_type, external_id) do update
       set payload = excluded.payload, payload_hash = excluded.payload_hash, source_url = excluded.source_url,
           retrieved_at = now(), last_run_id = excluded.last_run_id`,
    [rec.sourceId, rec.externalId, rec.entityType, rec.sourceUrl, JSON.stringify(rec.payload), hash, rec.runId],
  );
  return { changed: prev.length === 0 || prev[0].payload_hash !== hash, entityId: prev[0]?.entity_id ?? null };
}

export async function linkSourceRecord(db: Db, sourceId: string, entityType: string, externalId: string, entityId: string): Promise<void> {
  await db.query(
    "update source_records set entity_id = $4 where source_id = $1 and entity_type = $2 and external_id = $3",
    [sourceId, entityType, externalId, entityId],
  );
}
