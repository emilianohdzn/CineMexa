// Collector de TMDB: lectura y enriquecimiento sobre PGlite con respuestas sintéticas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { freshDb } from "./helpers/db.ts";
import { parseMovie, movieUrl, TMDB_ATTRIBUTION, type TmdbMovie } from "../collectors/tmdb/parse.ts";
import { runTmdbEnrich } from "../collectors/tmdb/run.ts";
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
    calls.push(url);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer token-prueba");
    const id = Number(url.match(/movie\/(\d+)/)![1]);
    return new Response(JSON.stringify({ ...movie, id, imdb_id: id === 9000001 ? movie.imdb_id : null }), { status: 200 });
  }) as typeof fetch;

  const first = await runTmdbEnrich(db, { token: "token-prueba", delayMs: 0, http: { fetchImpl } });
  assert.equal(first.status, "succeeded");
  assert.deepEqual(first.counts, { updated: 2, unchanged: 0 });

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

  const second = await runTmdbEnrich(db, { token: "token-prueba", delayMs: 0, http: { fetchImpl } });
  assert.deepEqual(second.counts, { updated: 0, unchanged: 2 });
  assert.equal(calls.length, 4);
});

test("sin token no corre", async () => {
  const db = await freshDb();
  await assert.rejects(runTmdbEnrich(db, { token: "" }), /TMDB_API_READ_TOKEN/);
});
