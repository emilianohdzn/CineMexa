// Job de tendencias: lee trend_signals, aplica trend_score (packages/core) y guarda un trend_snapshot
// por ventana. Si no hay evidencia suficiente, el ranking queda vacío: nunca se rellena.
// Uso: DATABASE_URL=... node backend/jobs/trends.ts
import { fileURLToPath } from "node:url";
import { computeTrendRanking, WINDOW_HOURS, type TrendObservation, type TrendWindow } from "../../packages/core/src/index.ts";
import type { Db } from "../collectors/lib/db.ts";

const HOUR = 3_600_000;

/**
 * Reparte un intervalo de varias horas en cubetas de una hora (valor uniforme), para que
 * trend_score compare periodos con la misma granularidad.
 */
export function toHourlyObservations(rows: Array<{ film_id: string; source_id: string; metric: string; bucket_start: Date | string; bucket_hours: number; value: number }>): TrendObservation[] {
  const out: TrendObservation[] = [];
  for (const r of rows) {
    const start = new Date(r.bucket_start).getTime();
    const hours = Math.max(1, r.bucket_hours);
    for (let h = 0; h < hours; h++) {
      out.push({ filmId: r.film_id, source: r.source_id, metric: r.metric, observedAt: new Date(start + h * HOUR).toISOString(), value: r.value / hours });
    }
  }
  return out;
}

export async function runTrendSnapshots(db: Db, now: Date, windows: TrendWindow[] = ["24h", "7d", "30d"], baselineWindows = 3) {
  const results = [];
  for (const window of windows) {
    // Ventana actual + K de línea base + 1 extra para el rango previo.
    const lookbackHours = WINDOW_HOURS[window] * (baselineWindows + 2);
    const { rows } = await db.query<any>(
      `select s.film_id::text, s.source_id, s.metric, s.bucket_start, s.bucket_hours, s.value
       from trend_signals s join films f on f.id = s.film_id and f.published and f.merged_into is null
       where s.bucket_start >= $1::timestamptz - make_interval(hours => $2) and s.bucket_start < $1::timestamptz`,
      [now.toISOString(), lookbackHours]);
    const { rows: titles } = await db.query<{ id: string; title: string }>("select id::text, title from films where published");
    const ranking = computeTrendRanking(toHourlyObservations(rows), {
      window, now, baselineWindows, titles: Object.fromEntries(titles.map((t) => [t.id, t.title])),
    });
    await db.query(
      `insert into trend_snapshots (window_key, computed_at, methodology_version, label, sources_used, entries)
       values ($1, $2, $3, $4, $5, $6) on conflict (window_key, computed_at) do update set entries = excluded.entries`,
      [window, ranking.computedAt, ranking.methodologyVersion, ranking.label, ranking.sourcesUsed, JSON.stringify(ranking.entries)]);
    results.push({ window, entries: ranking.entries.length, sources: ranking.sourcesUsed });
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1 });
  const db: Db = { query: async (q, params = []) => ({ rows: await sql.unsafe(q, params as never[]) as never[] }) };
  console.log(JSON.stringify(await runTrendSnapshots(db, new Date()), null, 2));
  await sql.end();
}
