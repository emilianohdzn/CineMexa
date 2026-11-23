// Collector de TMDB: enriquece las películas que ya tienen id de TMDB.
// Uso: TMDB_API_READ_TOKEN=... DATABASE_URL=... node backend/collectors/tmdb/run.ts [--limit 200]
// Sin token el conector queda deshabilitado y la app sigue funcionando.
import { fileURLToPath } from "node:url";
import { fetchJson, type FetchOptions } from "../lib/http.ts";
import type { Db } from "../lib/db.ts";
import { finishRun, startRun, type RunStatus } from "../lib/runs.ts";
import { movieUrl, parseMovie, type TmdbMovie } from "./parse.ts";
import { applyTmdb } from "./upsert.ts";

export interface TmdbRunOptions {
  token: string;
  limit?: number;
  /** Pausa entre peticiones (TMDB limita ~40-50 req/s). */
  delayMs?: number;
  http?: Omit<FetchOptions, "headers">;
}

export async function runTmdbEnrich(db: Db, opts: TmdbRunOptions) {
  if (!opts.token) throw new Error("Falta TMDB_API_READ_TOKEN: el conector de TMDB está deshabilitado.");
  const { limit = 200, delayMs = 50, http = {} } = opts;
  const runId = await startRun(db, "tmdb", "enrich_films", { limit });
  // Primero las que nunca se han consultado, luego las más antiguas.
  const { rows: targets } = await db.query<{ film_id: string; tmdb_id: string }>(
    `select e.film_id::text, e.external_id as tmdb_id from film_external_ids e
     join films f on f.id = e.film_id and f.merged_into is null
     left join source_records r on r.source_id = 'tmdb' and r.entity_type = 'film' and r.external_id = e.external_id
     where e.provider = 'tmdb' order by r.retrieved_at nulls first limit $1`, [limit]);

  const counts = { updated: 0, unchanged: 0 };
  const errors: string[] = [];
  for (const t of targets) {
    try {
      const movie = await fetchJson<TmdbMovie>(movieUrl(Number(t.tmdb_id)), {
        ...http, headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
      });
      counts[await applyTmdb(db, t.film_id, parseMovie(movie), runId)]++;
    } catch (error) {
      errors.push(`tmdb:${t.tmdb_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  const status: RunStatus = errors.length === 0 ? "succeeded" : errors.length < targets.length ? "partial" : "failed";
  await finishRun(db, runId, { status, seen: targets.length, upserted: counts.updated, error: errors.slice(0, 20).join("\n") || null, meta: { counts } });
  return { status, seen: targets.length, counts, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 200;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1 });
  const db: Db = { query: async (q, params = []) => ({ rows: await sql.unsafe(q, params as never[]) as never[] }) };
  console.log(JSON.stringify(await runTmdbEnrich(db, { token: process.env.TMDB_API_READ_TOKEN ?? "", limit }), null, 2));
  await sql.end();
}
