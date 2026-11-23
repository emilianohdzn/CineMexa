// YouTube (visualizaciones de tráilers) → trend_signals → trend_snapshots → catálogo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./helpers/db.ts";
import { runYoutubeViews, youtubeVideoId } from "../collectors/youtube/run.ts";
import { runTrendSnapshots, toHourlyObservations } from "../jobs/trends.ts";
import { handleCatalog } from "../catalog/handler.ts";

test("reconoce ids de video de YouTube", () => {
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=AbCdEfGhIj1&t=3"), "AbCdEfGhIj1");
  assert.equal(youtubeVideoId("https://youtu.be/AbCdEfGhIj1"), "AbCdEfGhIj1");
  assert.equal(youtubeVideoId("https://www.youtube.com/embed/AbCdEfGhIj1"), "AbCdEfGhIj1");
  assert.equal(youtubeVideoId("https://vimeo.com/123"), null);
  assert.equal(youtubeVideoId("no es url"), null);
});

test("reparte intervalos largos en horas", () => {
  const obs = toHourlyObservations([{ film_id: "f", source_id: "youtube", metric: "views_delta", bucket_start: "2026-11-23T00:00:00Z", bucket_hours: 4, value: 400 }]);
  assert.equal(obs.length, 4);
  assert.ok(obs.every((o) => o.value === 100));
  assert.equal(obs[3].observedAt, "2026-11-23T03:00:00.000Z");
});

test("de visualizaciones a ranking publicado, sin rellenar sin evidencia", async () => {
  const db = await freshDb();
  const films: string[] = [];
  for (const [i, slug] of ["uno", "dos", "tres"].entries()) {
    const { rows: [f] } = await db.query<{ id: string }>(
      `insert into films (slug, title, published, trailer_url) values ($1, $2, true, $3) returning id`,
      [slug, `Película ${slug}`, i < 2 ? `https://www.youtube.com/watch?v=video${i}AAAAA`.slice(0, 43) : null]);
    films.push(f.id);
  }
  // Vistas acumuladas por video y hora: la película "uno" se dispara en el último día.
  const views: Record<string, number> = { video0AAAAA: 10_000, video1AAAAA: 10_000 };
  let clock = new Date("2026-11-01T00:00:00Z");
  const seenKeys: string[] = [];
  const fetchImpl = (async (url: string) => {
    seenKeys.push(new URL(url).searchParams.get("key")!);
    const ids = new URL(url).searchParams.get("id")!.split(",");
    return new Response(JSON.stringify({ items: ids.map((id) => ({ id, statistics: { viewCount: String(views[id]) } })) }), { status: 200 });
  }) as typeof fetch;

  const first = await runYoutubeViews(db, { apiKey: "clave-prueba", now: () => clock, http: { fetchImpl } });
  assert.deepEqual([first.videos, first.signals, first.quotaUnits], [2, 0, 1], "la primera consulta sólo fija la línea base");

  for (let day = 1; day <= 22; day++) {
    views.video0AAAAA += day < 22 ? 1_000 : 9_000;
    views.video1AAAAA += 1_000;
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    await runYoutubeViews(db, { apiKey: "clave-prueba", now: () => clock, http: { fetchImpl } });
  }
  assert.ok(seenKeys.every((k) => k === "clave-prueba"));
  const { rows: [{ n }] } = await db.query<{ n: number }>("select count(*)::int as n from trend_signals");
  assert.equal(n, 44);

  const results = await runTrendSnapshots(db, clock, ["24h"]);
  assert.deepEqual(results, [{ window: "24h", entries: 2, sources: ["youtube"] }]);
  const { rows: [snap] } = await db.query<{ label: string; entries: any[] }>("select label, entries from trend_snapshots where window_key = '24h'");
  assert.equal(snap.label, "Tendencias digitales", "sólo YouTube → etiqueta honesta");
  assert.equal(snap.entries[0].filmId, films[0]);
  assert.ok(!snap.entries.some((e) => e.filmId === films[2]), "sin tráiler no hay evidencia y no entra");

  const body = await (await handleCatalog(new Request("https://x.test/catalog"), { db, now: () => clock })).json();
  const day = body.trends.find((t: any) => t.window === "24h");
  assert.equal(day.entries[0].film_id, films[0]);
  assert.match(day.entries[0].explanation, /^YouTube: visualizaciones \+/);
  assert.equal(body.meta.sources.find((s: any) => s.id === "youtube").status, "not_configured", "la fuente sigue deshabilitada hasta configurarla");
});

test("un error no expone la clave", async () => {
  const db = await freshDb();
  await db.query(`insert into films (slug, title, published, trailer_url) values ('x', 'X', true, 'https://youtu.be/AbCdEfGhIj1')`);
  const failing = (async (url: string) => new Response(`bad ${url}`, { status: 403 })) as unknown as typeof fetch;
  const r = await runYoutubeViews(db, { apiKey: "secreta123", http: { fetchImpl: failing } });
  assert.equal(r.status, "failed");
  assert.ok(!r.errors.join(" ").includes("secreta123"));
  const { rows: [run] } = await db.query<{ error: string }>("select error from ingestion_runs");
  assert.ok(!run.error.includes("secreta123"));
});
