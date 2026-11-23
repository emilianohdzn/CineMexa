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

test("la validación de tendencias cuenta mediciones, deltas, duplicados y ventanas", async () => {
  const { trendsHealth } = await import("../audit/trends.ts");
  const db = await freshDb();
  const film = async (slug: string, trailer: string) => (await db.query<{ id: string }>(
    "insert into films (slug, title, published, trailer_url) values ($1, $1, true, $2) returning id::text", [slug, trailer])).rows[0].id;
  const a = await film("a", "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  await film("b", "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  await db.query(`insert into trend_signals (film_id, source_id, metric, bucket_start, bucket_hours, value) values
    ($1, 'youtube', 'views_delta', '2026-11-23T06:00:00Z', 6, 1200), ($1, 'youtube', 'views_delta', '2026-11-23T12:00:00Z', 6, 900)`, [a]);
  const h = await trendsHealth(db);
  assert.equal(h.senales.senales, 2);
  assert.equal(h.senales.con_dos_o_mas, 1);
  assert.equal(h.senales.suma_delta, 2100);
  assert.equal(h.duplicados.length, 1, "un mismo tráiler en dos películas se reporta");
  assert.equal(h.suficiente_para_ranking, true);
});
