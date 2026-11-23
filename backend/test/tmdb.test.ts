// Collector de TMDB: lectura y enriquecimiento sobre PGlite con respuestas sintéticas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freshDb } from "./helpers/db.ts";
import { parseMovie, movieUrl, TMDB_ATTRIBUTION, type TmdbMovie } from "../collectors/tmdb/parse.ts";
import { runTmdbEnrich } from "../collectors/tmdb/run.ts";
import { applyMatch, findTmdbMatch, pendingMatchTargets, type MatchTarget } from "../collectors/tmdb/match.ts";
import { parseDiscoverResponse, type SparqlResponse } from "../collectors/wikidata/parse.ts";
import { upsertWikidataFilm } from "../collectors/wikidata/upsert.ts";
import { startRun } from "../collectors/lib/runs.ts";

const movie = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "tmdb-movie.json"), "utf8")) as TmdbMovie;
const sparql = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "wikidata-discover.json"), "utf8")) as SparqlResponse;

test("lee de TMDB sólo lo que corresponde a México", () => {
  const e = parseMovie(movie);
  assert.equal(e.mxReleaseDate, "2025-03-06", "estreno teatral en MX, no el de España ni el festival");
  assert.equal(e.trailerUrl, "https://www.youtube.com/watch?v=trailerES1", "prefiere el tráiler oficial en español");
  assert.equal(e.poster?.url, "https://image.tmdb.org/t/p/w780/pruebaPoster.jpg");
  assert.deepEqual(e.credits.map((c) => `${c.role}:${c.name}`), [
    "cast:Actriz Prueba Uno", "cast:Actor Prueba Dos", "director:Ana Prueba Ficticia",
    "cinematographer:Fotógrafa Prueba", "writer:Guionista Prueba",
  ], "sin duplicar guionista ni incluir oficios ajenos");
  assert.equal(e.credits[1].character, null);
  assert.equal(parseMovie({ id: 1 }).mxReleaseDate, null, "sin datos de MX no se deduce estreno");
  assert.match(movieUrl(5), /\/movie\/5\?language=es-MX&append_to_response=release_dates,credits,videos/);
});

test("enriquece la película, respeta pósters oficiales y es idempotente", async () => {
  const db = await freshDb();
  const run = await startRun(db, "wikidata", "test");
  const [a, b] = parseDiscoverResponse(sparql, "2026-11-23T00:00:00Z");
  const { filmId } = await upsertWikidataFilm(db, a, run);
  const other = (await upsertWikidataFilm(db, b, run)).filmId;
  // La segunda película tiene póster oficial editorial y un id de TMDB.
  await db.query(`insert into film_external_ids (film_id, provider, external_id) values ($1, 'tmdb', '9000002')`, [other]);
  await db.query(`insert into film_images (film_id, kind, url, source_id, is_official, is_primary)
    values ($1, 'poster', 'https://festival.example/poster.jpg', 'editorial', true, true)`, [other]);

  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer token-prueba");
    if (url.includes("/movie/changes")) return new Response(JSON.stringify({ results: [{ id: 9000002 }], total_pages: 1 }), { status: 200 });
    calls.push(url);
    const id = Number(url.match(/movie\/(\d+)/)![1]);
    return new Response(JSON.stringify({ ...movie, id, imdb_id: id === 9000001 ? movie.imdb_id : null }), { status: 200 });
  }) as typeof fetch;

  const first = await runTmdbEnrich(db, { token: "token-prueba", delayMs: 0, matchLimit: 0, http: { fetchImpl } });
  assert.equal(first.status, "succeeded");
  assert.deepEqual(first.counts, { updated: 2, unchanged: 0, obsolete: 0 });

  const { rows: [f] } = await db.query<Record<string, unknown>>(
    "select synopsis, synopsis_source_id, runtime_minutes, mx_release_date::text as mx, trailer_url from films where id = $1", [filmId]);
  assert.deepEqual(f, { synopsis: "Sinopsis ficticia de prueba.", synopsis_source_id: "tmdb", runtime_minutes: 98, mx: "2025-03-06",
    trailer_url: "https://www.youtube.com/watch?v=trailerES1" });

  const { rows: posters } = await db.query<{ film_id: string; url: string; is_primary: boolean; attribution: string | null }>(
    "select film_id::text, url, is_primary, attribution from film_images where kind = 'poster' order by film_id, url");
  const mine = posters.find((p) => p.film_id === filmId)!;
  assert.equal(mine.is_primary, true);
  assert.equal(mine.attribution, TMDB_ATTRIBUTION);
  const theirs = posters.filter((p) => p.film_id === other);
  assert.deepEqual(theirs.map((p) => [p.url, p.is_primary]), [
    ["https://festival.example/poster.jpg", true], ["https://image.tmdb.org/t/p/w780/pruebaPoster.jpg", false],
  ], "el póster oficial sigue siendo el principal");

  const { rows: [director] } = await db.query<{ n: number }>(
    "select count(*)::int as n from film_credits where film_id = $1 and role = 'director'", [filmId]);
  assert.equal(director.n, 2, "la directora de TMDB es la misma persona que la de Wikidata");
  const { rows: [ana] } = await db.query<{ wikidata_id: string; tmdb_id: number }>(
    "select wikidata_id, tmdb_id from people where name = 'Ana Prueba Ficticia'");
  assert.deepEqual(ana, { wikidata_id: "Q900000101", tmdb_id: 9201 });

  const second = await runTmdbEnrich(db, { token: "token-prueba", delayMs: 0, matchLimit: 0, http: { fetchImpl } });
  assert.deepEqual(second.counts, { updated: 0, unchanged: 2, obsolete: 0 });
  assert.equal(calls.length, 4);
});

test("sin token no corre", async () => {
  const db = await freshDb();
  await assert.rejects(runTmdbEnrich(db, { token: "" }), /TMDB_API_READ_TOKEN/);
});

// ── Vinculación de películas sin id de TMDB ──

const fakeTmdb = (routes: Record<string, unknown>) => {
  const calls: string[] = [];
  const get = async <T,>(url: string): Promise<T> => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`ruta no simulada: ${url}`);
    return routes[key] as T;
  };
  return { get, calls };
};
const target = (over: Partial<MatchTarget> = {}): MatchTarget =>
  ({ film_id: "f", title: "Los días felices", original_title: null, year: 2025, imdb_id: null, directors: ["Ana Pérez"], ...over });

test("vincula por IMDb cuando TMDB devuelve un único resultado de año compatible", async () => {
  const { get, calls } = fakeTmdb({ "/find/tt1234567": { movie_results: [{ id: 77, title: "Los días felices", release_date: "2025-05-01" }] } });
  const r = await findTmdbMatch(target({ imdb_id: "tt1234567" }), get);
  assert.equal(r.kind, "matched");
  assert.equal(r.kind === "matched" && r.tmdbId, 77);
  assert.equal(calls.length, 1, "no hace búsquedas por título si el identificador basta");
});

test("un título idéntico sin director en común nunca se vincula solo", async () => {
  const { get } = fakeTmdb({
    "/search/movie": { results: [{ id: 5, title: "Los días felices", release_date: "2025-01-01" }] },
    "/movie/5/credits": { crew: [{ job: "Director", name: "Otra Persona" }] },
  });
  const r = await findTmdbMatch(target(), get);
  assert.equal(r.kind, "review");
});

test("título idéntico + año ±1 + misma dirección: vínculo automático", async () => {
  const { get } = fakeTmdb({
    "/search/movie": { results: [
      { id: 5, title: "Los Días Felices", release_date: "2024-11-01" },
      { id: 6, title: "Días felices en la playa", release_date: "2025-01-01" },
      { id: 7, title: "Los días felices", release_date: "1987-01-01" },
    ] },
    "/movie/5/credits": { crew: [{ job: "Director", name: "Ana Pérez" }] },
  });
  const r = await findTmdbMatch(target(), get);
  assert.equal(r.kind, "matched");
  assert.equal(r.kind === "matched" && r.tmdbId, 5, "ni el título parecido ni el de otro año cuentan");
});

test("sin director local, los candidatos van a revisión; sin candidatos queda no_match", async () => {
  const { get } = fakeTmdb({
    "/search/movie": { results: [{ id: 5, title: "Los días felices", release_date: "2025-01-01" }] },
    "/movie/5/credits": { crew: [{ job: "Director", name: "Ana Pérez" }] },
  });
  assert.equal((await findTmdbMatch(target({ directors: [] }), get)).kind, "review");
  const none = fakeTmdb({ "/search/movie": { results: [{ id: 9, title: "Otra cosa", release_date: "2025-01-01" }] } });
  assert.equal((await findTmdbMatch(target(), none.get)).kind, "no_match");
});

test("aplica vínculos, manda duplicados a revisión y no repite búsquedas recientes", async () => {
  const db = await freshDb();
  const run = await startRun(db, "wikidata", "test");
  const [a, b] = parseDiscoverResponse(sparql, "2026-11-23T00:00:00Z");
  const filmA = (await upsertWikidataFilm(db, a, run)).filmId;
  const filmB = (await upsertWikidataFilm(db, b, run)).filmId;
  await db.query("delete from film_external_ids where provider = 'tmdb'");
  await db.query("update films set published = true");
  const targets = await pendingMatchTargets(db, 10, 14);
  assert.deepEqual(targets.map((t) => t.film_id).sort(), [filmA, filmB].sort());

  const tA = targets.find((t) => t.film_id === filmA)!, tB = targets.find((t) => t.film_id === filmB)!;
  assert.equal(await applyMatch(db, tA, { kind: "matched", tmdbId: 555, method: "imdb_find", evidence: {} }), "matched");
  assert.equal(await applyMatch(db, tB, { kind: "matched", tmdbId: 555, method: "title_year_director", evidence: {} }), "review",
    "el mismo id de TMDB en otra película es un posible duplicado");
  const { rows } = await db.query<{ film_id: string; status: string }>(
    "select entity_id::text as film_id, status from match_reviews order by status");
  assert.deepEqual(rows.map((r) => r.status), ["auto_matched", "pending"]);
  assert.deepEqual(await pendingMatchTargets(db, 10, 14), [], "ni la vinculada ni la pendiente se vuelven a buscar");
});

test("un 404 de TMDB marca el id como obsoleto sin fallar la corrida", async () => {
  const db = await freshDb();
  const run = await startRun(db, "wikidata", "test");
  const [a] = parseDiscoverResponse(sparql, "2026-11-23T00:00:00Z");
  await upsertWikidataFilm(db, a, run);
  const fetchImpl = (async () => new Response(JSON.stringify({ status_code: 34 }), { status: 404 })) as typeof fetch;
  const r = await runTmdbEnrich(db, { token: "t", delayMs: 0, matchLimit: 0, http: { fetchImpl } });
  assert.equal(r.status, "succeeded");
  assert.equal(r.counts.obsolete, 1);
  const again = await runTmdbEnrich(db, { token: "t", delayMs: 0, matchLimit: 0, http: { fetchImpl } });
  assert.equal(again.seen, 0, "no se vuelve a pedir un id obsoleto");
});

test("repara personas duplicadas por el orden de enriquecimiento sin fusionar homónimos de otras películas", async () => {
  const { findDuplicatePeople, mergeDuplicatePeople } = await import("../audit/people.ts");
  const db = await freshDb();
  const film = async (slug: string) => (await db.query<{ id: string }>(
    "insert into films (slug, title, published) values ($1, $1, true) returning id::text", [slug])).rows[0].id;
  const person = async (name: string, wd: string | null, tmdb: number | null) => (await db.query<{ id: string }>(
    "insert into people (name, name_key, wikidata_id, tmdb_id) values ($1, lower($1), $2, $3) returning id::text", [name, wd, tmdb])).rows[0].id;
  const credit = (f: string, p: string) => db.query("insert into film_credits (film_id, person_id, role) values ($1, $2, 'director')", [f, p]);
  const f1 = await film("uno"), f2 = await film("dos"), f3 = await film("tres");
  const wd = await person("ana perez", "Q1", null), tm = await person("ana perez", null, 77), other = await person("ana perez", "Q2", null);
  await credit(f1, tm);            // TMDB la creó desde la película 1
  await credit(f2, wd); await credit(f2, tm); // en la 2 quedó duplicada
  await credit(f3, other);         // homónima en otra película: no se toca
  const pairs = await findDuplicatePeople(db);
  assert.equal(pairs.length, 1);
  assert.equal(await mergeDuplicatePeople(db, pairs), 1);
  const { rows } = await db.query<{ slug: string; n: number }>(`select f.slug, count(*)::int as n from film_credits c
    join films f on f.id = c.film_id group by f.slug order by f.slug`);
  assert.deepEqual(rows, [{ slug: "dos", n: 1 }, { slug: "tres", n: 1 }, { slug: "uno", n: 1 }]);
  const { rows: [kept] } = await db.query<{ tmdb_id: number }>("select tmdb_id from people where id = $1", [wd]);
  assert.equal(kept.tmdb_id, 77);
  assert.deepEqual(await findDuplicatePeople(db), []);
});
