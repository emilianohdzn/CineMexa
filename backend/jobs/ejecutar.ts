// Ejecutor único de trabajos programados (GitHub Actions, la Mac o cualquier otra máquina).
// - Exclusión de corridas duplicadas: candado de Postgres por trabajo (pg_try_advisory_lock). Si otra máquina ya
//   está corriendo el mismo trabajo, ésta termina sin hacer nada (código 0) y lo dice.
// - Corridas abandonadas (proceso muerto con status 'running' de hace más de 3 h) se cierran como 'failed'.
// - Control de cuota: YouTube con presupuesto por corrida y por día (unidades registradas en ingestion_runs).
// - Límite de duración: el proceso se corta solo a los TIMEOUT_MIN minutos.
// - Resumen en JSON por consola y, en GitHub Actions, en el resumen del job. Código 1 sólo si la corrida falla.
// Uso: node jobs/ejecutar.ts <wikidata|festivales|tmdb|youtube|tendencias|youtube-y-tendencias|noticias>
// "wikidata" corre también "festivales" (necesita las películas recién descubiertas).
import { appendFileSync } from "node:fs";
import { openPostgres, type Db } from "../collectors/lib/db.ts";
import { runWikidataDiscover } from "../collectors/wikidata/run.ts";
import { runTmdbEnrich } from "../collectors/tmdb/run.ts";
import { runYoutubeViews } from "../collectors/youtube/run.ts";
import { runTrendSnapshots } from "./trends.ts";
import { runWikidataFestivals } from "../collectors/wikidata/festivals.ts";
import { runFeeds } from "../collectors/feeds/run.ts";

export type JobName = "wikidata" | "festivales" | "tmdb" | "youtube" | "tendencias" | "noticias";
const JOBS: Record<string, JobName[]> = {
  wikidata: ["wikidata", "festivales"], festivales: ["festivales"], tmdb: ["tmdb"], youtube: ["youtube"], tendencias: ["tendencias"],
  "youtube-y-tendencias": ["youtube", "tendencias"], noticias: ["noticias"],
};

export interface JobResult { job: JobName; status: "succeeded" | "partial" | "failed" | "skipped"; detail: unknown }

/** Cierra corridas que quedaron 'running' porque el proceso murió (runner cancelado, Mac apagada). */
export async function closeAbandonedRuns(db: Db, olderThanHours = 3): Promise<number> {
  const { rows } = await db.query<{ id: string }>(`
    update ingestion_runs set status = 'failed', finished_at = now(),
      error = coalesce(error, '') || 'Corrida abandonada: el proceso terminó sin cerrarla.'
    where status = 'running' and started_at < now() - make_interval(hours => $1) returning id::text`, [olderThanHours]);
  return rows.length;
}

/** Unidades de cuota de YouTube usadas en las últimas 24 h, según ingestion_runs. */
export async function youtubeUnitsLast24h(db: Db): Promise<number> {
  const { rows: [r] } = await db.query<{ units: number }>(`
    select coalesce(sum((meta ->> 'quotaUnits')::int), 0)::int as units from ingestion_runs
    where source_id = 'youtube' and started_at > now() - interval '24 hours'`);
  return r.units;
}

export async function withJobLock<T>(db: Db, job: string, fn: () => Promise<T>): Promise<T | "locked"> {
  const { rows: [l] } = await db.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext($1)) as ok", [`cinemexa:${job}`]);
  if (!l.ok) return "locked";
  try {
    return await fn();
  } finally {
    await db.query("select pg_advisory_unlock(hashtext($1))", [`cinemexa:${job}`]);
  }
}

export interface RunJobOptions {
  env: Record<string, string | undefined>;
  db: Db;
  connect?: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  now?: () => Date;
}

export async function runJob(job: JobName, { env, db, connect, now = () => new Date() }: RunJobOptions): Promise<JobResult> {
  const outcome = await withJobLock(db, job, async (): Promise<JobResult> => {
    switch (job) {
      case "wikidata": {
        const r = await runWikidataDiscover(db, {
          fromYear: Number(env.CATALOG_FROM_YEAR ?? 2024), userAgent: env.WIKIDATA_USER_AGENT ?? "",
          connect, concurrency: Number(env.WIKIDATA_CONCURRENCY ?? 4),
        });
        return { job, status: r.status, detail: { seen: r.seen, counts: r.counts, errors: r.errors.length } };
      }
      case "festivales": {
        const r = await runWikidataFestivals(db, { userAgent: env.WIKIDATA_USER_AGENT ?? "", fromYear: Number(env.CATALOG_FROM_YEAR ?? 2024) });
        return { job, status: r.status, detail: { counts: r.counts, errors: r.errors.length, avisos: r.warnings } };
      }
      case "noticias": {
        const r = await runFeeds(db, { userAgent: env.FEEDS_USER_AGENT ?? env.WIKIDATA_USER_AGENT ?? "", now: now() });
        return { job, status: r.status, detail: { counts: r.counts, errors: r.errors } };
      }
      case "tmdb": {
        const r = await runTmdbEnrich(db, {
          token: env.TMDB_API_READ_TOKEN ?? "", limit: Number(env.TMDB_LIMIT ?? 300), matchLimit: Number(env.TMDB_MATCH_LIMIT ?? 60),
        });
        return { job, status: r.status, detail: { seen: r.seen, counts: r.counts, match: r.match && { seen: r.match.seen, counts: r.match.counts }, errors: r.errors.length } };
      }
      case "youtube": {
        const daily = Number(env.YOUTUBE_DAILY_UNITS ?? 200);
        const used = await youtubeUnitsLast24h(db);
        const left = Math.max(0, daily - used);
        if (left === 0) return { job, status: "skipped", detail: { motivo: "Presupuesto diario de cuota agotado", used, daily } };
        const r = await runYoutubeViews(db, { apiKey: env.YOUTUBE_API_KEY ?? "", maxUnits: Math.min(Number(env.YOUTUBE_MAX_UNITS ?? 20), left) });
        return { job, status: r.status, detail: { videos: r.videos, signals: r.signals, quotaUnits: r.quotaUnits, usedLast24h: used + r.quotaUnits, daily, errors: r.errors.length } };
      }
      case "tendencias": {
        const r = await runTrendSnapshots(db, now());
        return { job, status: "succeeded", detail: r };
      }
    }
  });
  return outcome === "locked" ? { job, status: "skipped", detail: { motivo: "Otra corrida del mismo trabajo está en curso" } } : outcome;
}

function summarize(results: JobResult[]): string {
  const lines = ["| Trabajo | Estado | Detalle |", "| --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.job} | ${r.status} | \`${JSON.stringify(r.detail)}\` |`);
  return lines.join("\n");
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const name = process.argv[2] ?? "";
  const jobs = JOBS[name];
  if (!jobs) {
    console.error(`Trabajo desconocido "${name}". Opciones: ${Object.keys(JOBS).join(", ")}`);
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
  const timeoutMin = Number(process.env.TIMEOUT_MIN ?? 45);
  const timer = setTimeout(() => {
    console.error(`::error::Límite de ${timeoutMin} min alcanzado en ${name}; se corta la corrida.`);
    process.exit(1);
  }, timeoutMin * 60_000);
  timer.unref();
  const concurrency = Number(process.env.WIKIDATA_CONCURRENCY ?? 4);
  const { db, end, withConnection } = await openPostgres(url, { max: concurrency + 1 });
  const results: JobResult[] = [];
  try {
    // El candado vive en una conexión propia para que el pool no lo suelte a mitad de la corrida.
    await withConnection(async (lockDb) => {
      const abandoned = await closeAbandonedRuns(lockDb);
      if (abandoned) console.log(`Corridas abandonadas cerradas: ${abandoned}`);
      for (const job of jobs) {
        const r = await runJob(job, { env: process.env, db: lockDb, connect: withConnection });
        results.push(r);
        console.log(JSON.stringify(r));
        if (r.status === "failed") break; // tendencias sólo después de una medición que funcionó
        if (job === "youtube" && r.status === "skipped") break;
        if (job === "wikidata" && r.status === "skipped") break; // festivales depende del enlace de Wikidata
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const redacted = [process.env.DATABASE_URL, process.env.TMDB_API_READ_TOKEN, process.env.YOUTUBE_API_KEY]
      .filter((v): v is string => !!v && v.length > 8).reduce((t, v) => t.split(v).join("***"), message);
    results.push({ job: jobs[results.length] ?? jobs[0], status: "failed", detail: { error: redacted } });
    console.error(`::error::${redacted}`);
  } finally {
    await end();
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${name}\n\n${summarize(results)}\n\n`);
  for (const r of results) if (r.status === "partial") console.log(`::warning::${r.job} terminó parcial: ${JSON.stringify(r.detail)}`);
  process.exitCode = results.some((r) => r.status === "failed") ? 1 : 0;
}
