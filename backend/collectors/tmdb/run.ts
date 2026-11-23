// Collector de TMDB: enriquece las películas que ya tienen id de TMDB.
// Uso: TMDB_API_READ_TOKEN=... DATABASE_URL=... node backend/collectors/tmdb/run.ts [--limit 200]
// Sin token el conector queda deshabilitado y la app sigue funcionando.
import { fileURLToPath } from "node:url";
import { fetchJson, type FetchOptions } from "../lib/http.ts";
import { openPostgres, type Db } from "../lib/db.ts";
import { finishRun, startRun, type RunStatus } from "../lib/runs.ts";
import { movieUrl, parseMovie, TMDB_API, type TmdbMovie } from "./parse.ts";
import { applyTmdb } from "./upsert.ts";
import { HttpError } from "../lib/http.ts";
import { runTmdbMatch } from "./match.ts";

export interface TmdbRunOptions {
  token: string;
  limit?: number;
  /** Cuántas películas sin id de TMDB intentar vincular antes de enriquecer (0 = no buscar). */
  matchLimit?: number;
  /** Pausa entre peticiones (TMDB limita ~40-50 req/s). */
  delayMs?: number;
  http?: Omit<FetchOptions, "headers">;
}

export async function runTmdbEnrich(db: Db, opts: TmdbRunOptions) {
  if (!opts.token) throw new Error("Falta TMDB_API_READ_TOKEN: el conector de TMDB está deshabilitado.");
  const { limit = 200, matchLimit = 100, delayMs = 50, http = {} } = opts;
  const runId = await startRun(db, "tmdb", "enrich_films", { limit, matchLimit });
  // 1) Vincula películas sin id de TMDB (sólo con evidencia fuerte; lo ambiguo va a match_reviews).
  const match = matchLimit > 0 ? await runTmdbMatch(db, { token: opts.token, limit: matchLimit, http }) : null;
  // 2) Prioridad: nunca consultadas, luego las que TMDB marca como cambiadas en las últimas 24 h, luego las más antiguas.
  const changed = await recentChanges(opts.token, http).catch(() => [] as string[]);
  const { rows: targets } = await db.query<{ film_id: string; tmdb_id: string }>(
    `select e.film_id::text, e.external_id as tmdb_id from film_external_ids e
     join films f on f.id = e.film_id and f.merged_into is null
     left join source_records r on r.source_id = 'tmdb' and r.entity_type = 'film' and r.external_id = e.external_id
     where e.provider = 'tmdb'
       and not exists (select 1 from match_reviews m where m.entity_type = 'film' and m.entity_id = e.film_id
                       and m.provider = 'tmdb' and m.candidate_id = e.external_id and m.status = 'obsolete')
     order by r.retrieved_at is not null, e.external_id = any($2::text[]) desc, r.retrieved_at limit $1`, [limit, changed]);

  const counts = { updated: 0, unchanged: 0, obsolete: 0 };
  const errors: string[] = [];
  for (const t of targets) {
    try {
      const movie = await fetchJson<TmdbMovie>(movieUrl(Number(t.tmdb_id)), {
        ...http, headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
      });
      counts[await applyTmdb(db, t.film_id, parseMovie(movie), runId)]++;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        // El id (normalmente de Wikidata) ya no existe en TMDB: no es una falla de la corrida, va a revisión.
        await db.query(`
          insert into match_reviews (entity_type, entity_id, provider, candidate_id, method, status, evidence)
          values ('film', $1, 'tmdb', $2, 'tmdb_404', 'obsolete', '{"motivo": "TMDB responde 404 para este id"}')
          on conflict (entity_type, entity_id, provider, candidate_id) do update set status = 'obsolete', updated_at = now()`,
          [t.film_id, t.tmdb_id]);
        counts.obsolete++;
      } else {
        errors.push(`tmdb:${t.tmdb_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  const status: RunStatus = errors.length === 0 ? "succeeded" : errors.length < targets.length ? "partial" : "failed";
  const allErrors = [...(match?.errors ?? []), ...errors];
  await finishRun(db, runId, {
    status, seen: targets.length, upserted: counts.updated, error: allErrors.slice(0, 20).join("\n") || null,
    meta: { counts, match: match ? { seen: match.seen, counts: match.counts, errors: match.errors.length } : null },
  });
  return { status, seen: targets.length, counts, match, errors: allErrors };
}

/** Ids de películas que cambiaron en TMDB en las últimas 24 h (hasta 3 páginas; 1 petición por página). */
async function recentChanges(token: string, http: Omit<FetchOptions, "headers">): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetchJson<{ results: Array<{ id: number }>; total_pages: number }>(`${TMDB_API}/movie/changes?page=${page}`, {
      ...http, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    ids.push(...r.results.map((x) => String(x.id)));
    if (page >= r.total_pages) break;
  }
  return ids;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 200;
  const matchLimit = args.includes("--match-limit") ? Number(args[args.indexOf("--match-limit") + 1]) : 100;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
  const { db, end } = await openPostgres(url);
  console.log(JSON.stringify(await runTmdbEnrich(db, { token: process.env.TMDB_API_READ_TOKEN ?? "", limit, matchLimit }), null, 2));
  await end();
}
