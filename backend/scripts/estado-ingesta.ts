// Estado de la ingesta en la base real: últimas corridas y conteos. Sólo lectura; no imprime secretos.
// Uso: node scripts/estado-ingesta.ts
import postgres from "postgres";
import { loadLocalEnv, redactor } from "./env.ts";

const env = loadLocalEnv();
const redact = redactor(env);
const sql = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 20, prepare: false });
try {
  const runs = await sql`
    select source_id, job, status, started_at, finished_at, records_seen, records_upserted,
           left(coalesce(error, ''), 200) as error
    from ingestion_runs order by started_at desc limit 8`;
  console.table(runs);
  const [counts] = await sql`
    select (select count(*) from films) as films,
           (select count(*) from films where published) as publicadas,
           (select count(*) from film_external_ids) as ids_externos,
           (select count(*) from film_images) as imagenes,
           (select count(*) from source_records) as registros_fuente,
           (select count(*) from festivals) as festivales,
           (select count(*) from trend_signals) as senales_tendencia,
           (select count(*) from trend_snapshots) as instantaneas_tendencia`;
  console.table([counts]);
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  await sql.end();
}
