// Collector de Wikidata: consulta, lectura de la respuesta y escritura en Postgres (PGlite).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDiscoverQuery, discoverUrl } from "../collectors/wikidata/sparql.ts";
import { parseDiscoverResponse, type SparqlResponse } from "../collectors/wikidata/parse.ts";
import { upsertWikidataFilm } from "../collectors/wikidata/upsert.ts";
import { fetchMexicanFilms, runWikidataDiscover } from "../collectors/wikidata/run.ts";
import { fetchJson, HttpError } from "../collectors/lib/http.ts";
import { startRun } from "../collectors/lib/runs.ts";
import { freshDb, type TestDb } from "./helpers/db.ts";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "wikidata-discover.json"), "utf8")) as SparqlResponse;
const NOW = "2026-11-23T06:00:00.000Z";
const UA = "CineMexaBot/0.1 (https://github.com/emilianohdzn/CineMexa)";

test("la consulta filtra por México, año y pagina por Q-id", () => {
  const q = buildDiscoverQuery({ fromYear: 2020, limit: 500, offset: 1000 });
  assert.match(q, /wdt:P495 wd:Q96/);
  assert.match(q, /FILTER\(YEAR\(\?date\) >= 2020\)/);
  assert.match(q, /ORDER BY \?film\s+LIMIT 500\s+OFFSET 1000$/);
  assert.throws(() => buildDiscoverQuery({ fromYear: 2020.5, limit: 1, offset: 0 }));
  assert.ok(discoverUrl({ fromYear: 2020, limit: 1, offset: 0 }).startsWith("https://query.wikidata.org/sparql?format=json&query="));
});

test("lee la respuesta sin inventar datos", () => {
  const films = parseDiscoverResponse(fixture, NOW);
  assert.equal(films.length, 3, "se descarta la película cuya única etiqueta es su Q-id");
  const [a, b, c] = films;

  assert.equal(a.title, "La sombra del mezquite");
  assert.equal(a.originalTitle, null, "igual al título: no se duplica");
  assert.equal(a.englishTitle, "The Mesquite Shadow");
  assert.equal(a.year, 2024);
  assert.equal(a.releaseDate, "2024-09-14");
  assert.equal(a.kind, "feature");
  assert.deepEqual(a.countries, ["ES", "MX"]);
  assert.equal(a.mxParticipation, "coproduction");
  assert.deepEqual(a.directorsWithIds, [
    { wikidataId: "Q900000101", name: "Ana Prueba Ficticia" },
    { wikidataId: "Q900000102", name: "Luis Ejemplo" },
  ]);
  assert.deepEqual(a.genres, ["Drama"], "los géneros desconocidos se ignoran");
  assert.deepEqual(a.ids, { wikidata: "Q900000001", tmdb: 9000001, imdb: "tt90000001" });
  assert.equal(a.provenance.verification, "automatic");
  assert.equal(a.provenance.sourceUrl, "https://www.wikidata.org/wiki/Q900000001");

  assert.equal(b.title, "Salt Water", "sin etiqueta en español usa la inglesa");
  assert.equal(b.kind, "short", "18 minutos ≤ 40 → corto");
  assert.equal(b.isDocumentary, true);
  assert.equal(b.mxParticipation, "unknown", "sólo México: no se infiere mayoritaria");
  assert.deepEqual(b.ids, { wikidata: "Q900000002", tmdb: null, imdb: null });

  assert.equal(c.kind, "short");
  assert.equal(c.isAnimation, true);
  assert.equal(c.year, 2022);
  assert.equal(c.releaseDate, null, "sólo año: no se inventa día");
  assert.deepEqual(c.countries, ["FR", "MX"], "códigos inválidos se descartan");
});

let db: TestDb;
before(async () => { db = await freshDb(); });

test("crea, re-ejecuta sin cambios y actualiza cuando cambia la fuente", async () => {
  const [film] = parseDiscoverResponse(fixture, NOW);
  const run = await startRun(db, "wikidata", "test");

  const first = await upsertWikidataFilm(db, film, run);
  assert.equal(first.outcome, "created");
  const { rows: [row] } = await db.query<Record<string, unknown>>("select * from films where id = $1", [first.filmId]);
  assert.equal(row.slug, "la-sombra-del-mezquite-2024");
  assert.equal(row.published, true);
  assert.equal(row.verification, "automatic");
  assert.deepEqual(row.genres, ["Drama"]);

  const ids = await db.query<{ provider: string; is_canonical: boolean }>(
    "select provider, is_canonical from film_external_ids where film_id = $1 order by provider", [first.filmId]);
  assert.deepEqual(ids.rows, [
    { provider: "imdb", is_canonical: false }, { provider: "tmdb", is_canonical: false }, { provider: "wikidata", is_canonical: true },
  ]);
  const credits = await db.query("select p.name from film_credits c join people p on p.id = c.person_id where c.film_id = $1 order by c.ord", [first.filmId]);
  assert.deepEqual(credits.rows.map((r) => r.name), ["Ana Prueba Ficticia", "Luis Ejemplo"]);

  // Misma respuesta en otra hora → sin cambios.
  const again = await upsertWikidataFilm(db, { ...film, provenance: { ...film.provenance, retrievedAt: "2026-11-24T00:00:00Z" } }, run);
  assert.deepEqual([again.outcome, again.filmId], ["unchanged", first.filmId]);

  // La fuente corrige la duración → se actualiza la misma película.
  const updated = await upsertWikidataFilm(db, { ...film, runtimeMinutes: 101 }, run);
  assert.deepEqual([updated.outcome, updated.filmId], ["updated", first.filmId]);
  const { rows: [after] } = await db.query<{ runtime_minutes: number }>("select runtime_minutes from films where id = $1", [first.filmId]);
  assert.equal(after.runtime_minutes, 101);
});

test("no sobrescribe datos editoriales; sólo completa huecos", async () => {
  const [, short] = parseDiscoverResponse(fixture, NOW);
  const run = await startRun(db, "wikidata", "test");
  const { filmId } = await upsertWikidataFilm(db, short, run);
  await db.query("update films set title = 'Agua salada', verification = 'editorial', runtime_minutes = null where id = $1", [filmId]);
  await upsertWikidataFilm(db, { ...short, title: "Saltwater", runtimeMinutes: 19 }, run);
  const { rows: [row] } = await db.query<{ title: string; runtime_minutes: number }>("select title, runtime_minutes from films where id = $1", [filmId]);
  assert.equal(row.title, "Agua salada");
  assert.equal(row.runtime_minutes, 19);
});

test("un título igual sin Q-id no se fusiona: se crea aparte y queda para revisión", async () => {
  await db.query(`insert into films (slug, title, year, verification, published) values ('ruido-editorial', 'El Ruido Blanco', 2026, 'editorial', true)`);
  const run = await startRun(db, "wikidata", "test");
  const film = { ...parseDiscoverResponse(fixture, NOW)[1], wikidataId: "Q900000009", title: "Ruido blanco", year: 2026,
    ids: { wikidata: "Q900000009", tmdb: null, imdb: null } };
  const result = await upsertWikidataFilm(db, film, run);
  assert.equal(result.outcome, "flagged");
  assert.deepEqual(result.conflicts, ["posible duplicado de ruido-editorial"]);
  const { rows: [row] } = await db.query<{ needs_review: boolean; published: boolean }>("select needs_review, published from films where id = $1", [result.filmId]);
  assert.deepEqual(row, { needs_review: true, published: false });
});

test("un IMDb ya asignado a otra película se marca como conflicto", async () => {
  const run = await startRun(db, "wikidata", "test");
  const [a] = parseDiscoverResponse(fixture, NOW);
  const clash = { ...a, wikidataId: "Q900000010", title: "Otra cosa", year: 2010, ids: { wikidata: "Q900000010", imdb: "tt90000001", tmdb: null } };
  // Coincide por IMDb con la película existente → se resuelve a ella, pero su Q-id distinto es un conflicto.
  const result = await upsertWikidataFilm(db, clash, run);
  assert.equal(result.outcome, "flagged");
  assert.ok(result.conflicts.some((c) => c.startsWith("wikidata distinto")));
});

test("corrida completa: pagina, registra ingestion_runs y conserva datos si la fuente falla", async () => {
  const local = await freshDb();
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    assert.equal((init?.headers as Record<string, string>)["User-Agent"], UA);
    return new Response(JSON.stringify(fixture), { status: 200 });
  }) as typeof fetch;
  const ok = await runWikidataDiscover(local, { fromYear: 2020, pageSize: 4, maxPages: 2, userAgent: UA, http: { fetchImpl } });
  assert.equal(calls.length, 2, "página llena → pide la siguiente");
  assert.equal(ok.status, "succeeded");
  assert.equal(ok.seen, 6);
  assert.deepEqual(ok.counts, { created: 3, updated: 0, unchanged: 3, flagged: 0 });

  const failing = (async () => new Response("rate limited", { status: 503 })) as unknown as typeof fetch;
  const bad = await runWikidataDiscover(local, { fromYear: 2020, userAgent: UA, http: { fetchImpl: failing, retries: 1, sleep: async () => {} } });
  assert.equal(bad.status, "failed");
  const { rows } = await local.query<{ status: string; records_seen: number }>(
    "select status::text as status, records_seen from ingestion_runs order by started_at, status");
  assert.deepEqual(rows.map((r) => r.status).sort(), ["failed", "succeeded"]);
  const { rows: [count] } = await local.query<{ n: number }>("select count(*)::int as n from films");
  assert.equal(count.n, 3, "la falla no borra lo último válido");
});

test("exige un User-Agent identificable y reintenta 429 respetando Retry-After", async () => {
  await assert.rejects(fetchMexicanFilms({ fromYear: 2020, userAgent: "CineMexaBot/0.1 (contacto: definir)" }), /WIKIDATA_USER_AGENT/);
  const waits: number[] = [];
  let n = 0;
  const fetchImpl = (async () => (++n === 1
    ? new Response("slow down", { status: 429, headers: { "retry-after": "7" } })
    : new Response("{\"ok\":true}", { status: 200 }))) as unknown as typeof fetch;
  assert.deepEqual(await fetchJson("https://x.test", { fetchImpl, sleep: async (ms) => { waits.push(ms); } }), { ok: true });
  assert.deepEqual(waits, [7000]);
  const notFound = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(fetchJson("https://x.test", { fetchImpl: notFound }), HttpError);
});
