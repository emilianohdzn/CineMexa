// Catálogo v1: qué se publica (RLS como anon), forma del contrato y caché HTTP.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freshDb, type TestDb } from "./helpers/db.ts";
import { parseDiscoverResponse, type SparqlResponse } from "../collectors/wikidata/parse.ts";
import { upsertWikidataFilm } from "../collectors/wikidata/upsert.ts";
import { finishRun, startRun } from "../collectors/lib/runs.ts";
import { handleCatalog } from "../catalog/handler.ts";

const NOW = new Date("2026-11-23T18:00:00Z");
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "wikidata-discover.json"), "utf8")) as SparqlResponse;
let db: TestDb;
let filmA: string;
let filmB: string;

before(async () => {
  db = await freshDb();
  const run = await startRun(db, "wikidata", "test");
  const films = parseDiscoverResponse(fixture, NOW.toISOString());
  filmA = (await upsertWikidataFilm(db, films[0], run)).filmId;
  filmB = (await upsertWikidataFilm(db, films[1], run)).filmId;
  await finishRun(db, run, { status: "succeeded", seen: 2, upserted: 2 });
  // Película no publicada: no debe salir.
  await db.query(`insert into films (slug, title, published) values ('oculta', 'Oculta', false)`);

  // Festival (datos de prueba) con sede, edición en curso, selección con fecha y una sin fecha.
  const { rows: [venue] } = await db.query<{ id: string }>(`insert into venues (name, city, country, latitude, longitude, coordinate_precision)
    values ('Sede prueba', 'Morelia', 'MX', 19.70, -101.19, 'city') returning id`);
  const { rows: [fest] } = await db.query<{ id: string }>(`insert into festivals (slug, name, short_name, city, country, default_venue_id)
    values ('fest-prueba', 'Festival de Prueba', 'FP', 'Morelia', 'MX', $1) returning id`, [venue.id]);
  await db.query(`insert into festivals (slug, name, city, country) values ('sin-sede', 'Sin sede', 'X', 'MX')`);
  const { rows: [ed] } = await db.query<{ id: string }>(`insert into festival_editions (festival_id, edition_label, year, starts_on, ends_on, source_id, verification)
    values ($1, '2026', 2026, '2026-11-20', '2026-11-29', 'editorial', 'editorial') returning id`, [fest.id]);
  await db.query(`insert into festival_events (edition_id, film_id, kind, section, occurs_at, source_id, verification)
    values ($1, $2, 'screening', 'Competencia', '2026-11-25T02:00:00Z', 'editorial', 'editorial'),
           ($1, $3, 'selection', 'Cortometraje', null, 'editorial', 'editorial')`, [ed.id, filmA, filmB]);
  await db.query(`insert into festival_events (edition_id, film_id, kind, award_name, source_id, verification)
    values ($1, $2, 'award', 'Premio no confirmado', 'editorial', 'unverified')`, [ed.id, filmB]);
  await db.query(`insert into trend_snapshots (window_key, computed_at, methodology_version, label, sources_used, entries)
    values ('7d', '2026-11-23T12:00:00Z', 'trend_score/1.0', 'Tendencias digitales', '{youtube}', $1)`,
    [JSON.stringify([{ filmId: filmA, rank: 1, previousRank: null, score: 80, rawScore: 1.2, explanation: "YouTube: +40%.",
      signals: [{ source: "youtube", metric: "views_delta", current: 140, baseline: 100, growthPct: 40, component: 1 }] }])]);
});

async function getCatalog(headers: Record<string, string> = {}) {
  return handleCatalog(new Request("https://x.test/catalog?v=1", { headers }), { db, now: () => NOW });
}

test("publica sólo lo que RLS deja ver y cumple el contrato v1", async () => {
  const res = await getCatalog();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["festival_events", "festivals", "films", "meta", "news", "reviews", "screenings", "streaming", "timeline", "trends"]);
  assert.equal(body.meta.mode, "live");
  assert.equal(body.meta.api_version, "1");
  assert.deepEqual(body.films.map((f: any) => f.title).sort(), ["La sombra del mezquite", "Salt Water"], "lo no publicado no sale");

  const a = body.films.find((f: any) => f.id === filmA);
  assert.deepEqual(a.directors, ["Ana Prueba Ficticia", "Luis Ejemplo"]);
  assert.deepEqual(a.alt_titles, ["The Mesquite Shadow"]);
  assert.equal(a.poster, null, "sin imagen autorizada no hay póster");
  assert.equal(a.status, "festival", "función de festival en ±30 días");
  assert.equal(a.provenance.source, "wikidata");
  assert.equal(a.provenance.source_url, "https://www.wikidata.org/wiki/Q900000001");
  assert.equal(a.provenance.verification, "automatic");

  assert.deepEqual(body.festivals.map((f: any) => f.slug), ["fest-prueba"], "festival sin sede no entra al mapa");
  assert.equal(body.festivals[0].editions[0].starts_on, "2026-11-20");
  assert.equal(body.festival_events.length, 2, "el premio 'unverified' no se publica");
  const sel = body.festival_events.find((e: any) => e.kind === "selection");
  assert.equal(sel.occurs_at, null, "sin fecha confirmada sigue en null");
  assert.deepEqual(body.timeline.map((t: any) => t.label), ["Función · FP"], "sin fecha no hay hito");

  assert.equal(body.trends.length, 1);
  assert.deepEqual(body.trends[0].entries[0].signals[0], { source: "youtube", metric: "views_delta", current: 140, baseline: 100, growth_pct: 40 });
  assert.equal(body.trends[0].is_demo, false);
  assert.equal(body.trends[0].history.length, 1);

  const wd = body.meta.sources.find((s: any) => s.id === "wikidata");
  assert.equal(wd.status, "ok");
  assert.ok(wd.last_sync_at);
  assert.equal(body.meta.sources.find((s: any) => s.id === "tmdb").status, "not_configured");
});

test("ETag estable: el mismo contenido responde 304 aunque cambie la hora", async () => {
  const first = await getCatalog();
  const etag = first.headers.get("etag")!;
  assert.match(first.headers.get("cache-control")!, /max-age=300/);
  const again = await handleCatalog(new Request("https://x.test/catalog", { headers: { "if-none-match": etag } }),
    { db, now: () => new Date(NOW.getTime() + 60_000) });
  assert.equal(again.status, 304);
});

test("rechaza métodos y versiones no soportados; un fallo de base es 503", async () => {
  assert.equal((await handleCatalog(new Request("https://x.test/catalog", { method: "POST" }), { db })).status, 405);
  assert.equal((await handleCatalog(new Request("https://x.test/catalog?delta=1", { method: "POST", body: "no es json" }), { db })).status, 400);
  assert.equal((await handleCatalog(new Request("https://x.test/catalog?v=2"), { db })).status, 400);
  const broken = { query: async () => { throw new Error("sin conexión"); } };
  const origError = console.error; console.error = () => {};
  try {
    const res = await handleCatalog(new Request("https://x.test/catalog"), { db: broken });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "60");
  } finally { console.error = origError; }
});

test("muestra del catálogo para la prueba de decodificación en Swift", async () => {
  // Se regenera con: CINEMEXA_WRITE_SAMPLE=1 npm test
  const body = await (await getCatalog()).json();
  const path = join(import.meta.dirname, "..", "..", "ios", "CineMexaTests", "Fixtures", "live-catalog-sample.json");
  if (process.env.CINEMEXA_WRITE_SAMPLE) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(path, ".."), { recursive: true });
    // Ids estables para que el archivo no cambie en cada corrida.
    let text = JSON.stringify(body, null, 2);
    [filmA, filmB].forEach((id, i) => { text = text.replaceAll(id, `film-${i + 1}`); });
    text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => `id-${m.slice(0, 8)}`);
    writeFileSync(path, text + "\n");
  }
  const sample = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(sample).sort(), Object.keys(body).sort(), "la muestra está al día con el contrato");
});

async function postDelta(known: Array<{ id: string; hash: string }>) {
  return handleCatalog(new Request("https://x.test/catalog?v=1&delta=1", {
    method: "POST", body: JSON.stringify({ known_films: known }), headers: { "content-type": "application/json" },
  }), { db, now: () => NOW });
}

test("incremental: sin cambios no reenvía películas y conserva el orden completo", async () => {
  const full = await (await getCatalog()).json();
  assert.equal(full.meta.film_hashes.length, full.films.length);
  const res = await postDelta(full.meta.film_hashes);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const delta = await res.json();
  assert.deepEqual(delta.films, []);
  assert.deepEqual(delta.meta.delta.film_ids, full.films.map((f: any) => f.id));
  assert.equal(delta.festivals.length, full.festivals.length, "las demás secciones van completas");
});

test("incremental: reenvía sólo lo cambiado y omite lo eliminado, aun tras días sin conexión", async () => {
  const before = await (await getCatalog()).json();
  // Cache vieja: conoce una película que ya no existe y tiene una huella vieja de otra.
  const known = [
    { id: "pelicula-borrada", hash: "0000000000000000" },
    { id: filmA, hash: "huella-vieja" },
    ...before.meta.film_hashes.filter((h: any) => h.id !== filmA),
  ];
  await db.query("update films set synopsis = 'Sinopsis corregida' where id = $1", [filmA]);
  const later = new Date(NOW.getTime() + 5 * 86_400_000);
  const delta = await (await handleCatalog(new Request("https://x.test/catalog?v=1&delta=1", {
    method: "POST", body: JSON.stringify({ known_films: known }),
  }), { db, now: () => later })).json();
  assert.deepEqual(delta.films.map((f: any) => f.id), [filmA]);
  assert.equal(delta.films[0].synopsis, "Sinopsis corregida");
  assert.ok(!delta.meta.delta.film_ids.includes("pelicula-borrada"));
  // Reconstruir: lo cambiado + lo conocido en el orden vigente = catálogo completo.
  const full = await (await handleCatalog(new Request("https://x.test/catalog?v=1"), { db, now: () => later })).json();
  const byId = new Map(before.films.map((f: any) => [f.id, f]));
  for (const f of delta.films) byId.set(f.id, f);
  assert.deepEqual(delta.meta.delta.film_ids.map((id: string) => byId.get(id)), full.films);
  await db.query("update films set synopsis = null where id = $1", [filmA]);
});
