// Collector de Wikidata: descubre películas mexicanas y las guarda.
// Uso: node backend/collectors/wikidata/run.ts --from-year 2020 [--dry-run]
// En producción corre como tarea programada con DATABASE_URL (rol de servicio). Nunca en la app.
import { fetchJson, type FetchOptions } from "../lib/http.ts";
import { openPostgres, type Db } from "../lib/db.ts";
import { finishRun, startRun, type RunStatus } from "../lib/runs.ts";
import { discoverUrl } from "./sparql.ts";
import { parseDiscoverResponse, type SparqlResponse, type WikidataFilm } from "./parse.ts";
import { upsertWikidataFilm, type UpsertOutcome } from "./upsert.ts";

export interface DiscoverOptions {
  fromYear: number;
  pageSize?: number;
  maxPages?: number;
  userAgent: string;
  http?: Omit<FetchOptions, "headers">;
  now?: () => Date;
}

/** Descarga todas las páginas. Se detiene en la primera página incompleta. */
export async function fetchMexicanFilms(opts: DiscoverOptions): Promise<WikidataFilm[]> {
  const { fromYear, pageSize = 500, maxPages = 40, userAgent, http = {}, now = () => new Date() } = opts;
  if (!userAgent || /definir/i.test(userAgent)) {
    throw new Error("WIKIDATA_USER_AGENT debe identificar el proyecto y un contacto (política de Wikimedia).");
  }
  const films: WikidataFilm[] = [];
  for (let page = 0; page < maxPages; page++) {
    const json = await fetchJson<SparqlResponse>(discoverUrl({ fromYear, limit: pageSize, offset: page * pageSize }), {
      ...http,
      headers: { "User-Agent": userAgent, Accept: "application/sparql-results+json" },
    });
    films.push(...parseDiscoverResponse(json, now().toISOString()));
    if (json.results.bindings.length < pageSize) break;
  }
  return films;
}

export interface RunSummary {
  status: RunStatus;
  seen: number;
  counts: Record<UpsertOutcome, number>;
  errors: string[];
}

export async function runWikidataDiscover(db: Db, opts: DiscoverOptions): Promise<RunSummary> {
  const runId = await startRun(db, "wikidata", "discover_films", { fromYear: opts.fromYear });
  const counts: Record<UpsertOutcome, number> = { created: 0, updated: 0, unchanged: 0, flagged: 0 };
  const errors: string[] = [];
  let films: WikidataFilm[];
  try {
    films = await fetchMexicanFilms(opts);
  } catch (error) {
    // La fuente falló: se conserva lo último válido y la corrida queda como failed.
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(db, runId, { status: "failed", seen: 0, upserted: 0, error: message });
    return { status: "failed", seen: 0, counts, errors: [message] };
  }
  for (const film of films) {
    try {
      counts[(await upsertWikidataFilm(db, film, runId)).outcome]++;
    } catch (error) {
      errors.push(`${film.wikidataId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const status: RunStatus = errors.length === 0 ? "succeeded" : errors.length < films.length ? "partial" : "failed";
  await finishRun(db, runId, {
    status, seen: films.length, upserted: counts.created + counts.updated + counts.flagged,
    error: errors.length ? errors.slice(0, 20).join("\n") : null, meta: { counts },
  });
  return { status, seen: films.length, counts, errors };
}

// CLI (sólo al ejecutarse directamente).
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const fromYear = Number(args[args.indexOf("--from-year") + 1] || new Date().getFullYear() - 5);
  const userAgent = process.env.WIKIDATA_USER_AGENT ?? "";
  if (args.includes("--dry-run")) {
    const films = await fetchMexicanFilms({ fromYear, userAgent });
    console.log(JSON.stringify({ total: films.length, sample: films.slice(0, 5) }, null, 2));
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
    const { db, end } = await openPostgres(url);
    console.log(JSON.stringify(await runWikidataDiscover(db, { fromYear, userAgent }), null, 2));
    await end();
  }
}
