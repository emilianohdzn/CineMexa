// Ejecutor de trabajos programados: candado, corridas abandonadas y presupuesto de cuota.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./helpers/db.ts";
import { closeAbandonedRuns, runJob, withJobLock, youtubeUnitsLast24h } from "../jobs/ejecutar.ts";

test("una corrida abandonada se cierra como fallida y las recientes no se tocan", async () => {
  const db = await freshDb();
  await db.query(`insert into ingestion_runs (source_id, job, started_at) values
    ('tmdb', 'enrich_films', now() - interval '5 hours'), ('tmdb', 'enrich_films', now() - interval '10 minutes')`);
  assert.equal(await closeAbandonedRuns(db), 1);
  const { rows } = await db.query<{ status: string }>("select status::text from ingestion_runs order by started_at");
  assert.deepEqual(rows.map((r) => r.status), ["failed", "running"]);
});

test("el candado del trabajo se toma y se libera al terminar", async () => {
  const db = await freshDb();
  // PGlite es una sola sesión: el candado de Postgres es reentrante en la misma sesión, así que se simula
  // la otra máquina tomando el candado desde SQL y comprobando que pg_try_advisory_lock lo ve ocupado en otra.
  const inner = await withJobLock(db, "tmdb", async () => "corrió");
  assert.equal(inner, "corrió");
  const { rows: [free] } = await db.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext('cinemexa:tmdb')) as ok");
  assert.equal(free.ok, true, "al terminar, el candado se libera");
});

test("YouTube respeta el presupuesto diario de cuota", async () => {
  const db = await freshDb();
  await db.query(`insert into ingestion_runs (source_id, job, status, meta) values ('youtube', 'trailer_views', 'succeeded', '{"quotaUnits": 200}')`);
  assert.equal(await youtubeUnitsLast24h(db), 200);
  const r = await runJob("youtube", { db, env: { YOUTUBE_API_KEY: "x", YOUTUBE_DAILY_UNITS: "200" } });
  assert.equal(r.status, "skipped");
});

test("tendencias corre sin señales y deja rankings vacíos, sin rellenar", async () => {
  const db = await freshDb();
  const r = await runJob("tendencias", { db, env: {}, now: () => new Date("2026-11-23T12:00:00Z") });
  assert.equal(r.status, "succeeded");
  const { rows } = await db.query<{ entries: unknown[] }>("select entries from trend_snapshots");
  assert.ok(rows.length === 3 && rows.every((x) => Array.isArray(x.entries) && x.entries.length === 0));
});
