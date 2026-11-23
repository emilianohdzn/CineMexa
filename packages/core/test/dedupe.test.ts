import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeFilms, matchFilms, mergeCandidates } from "../src/dedupe.ts";
import type { FilmCandidate } from "../src/types.ts";

const prov = (source: string, verification: FilmCandidate["provenance"]["verification"] = "automatic") => ({
  source, sourceUrl: null, retrievedAt: "2026-11-23T00:00:00Z", verification,
});

const wd: FilmCandidate = {
  title: "Sueño de Agua", year: 2025, kind: "feature", countries: ["Q96", "ES"],
  directors: ["Ana Ruíz"], ids: { wikidata: "Q111" }, provenance: prov("wikidata"),
};
const tmdb: FilmCandidate = {
  title: "Sueño de agua", originalTitle: "Sueño de agua", year: 2026, kind: "feature",
  runtimeMinutes: 98, countries: ["MX"], directors: ["Ana Ruiz"],
  ids: { tmdb: 42, wikidata: "Q111" }, provenance: prov("tmdb"),
};

test("mismo Q-id de Wikidata es coincidencia exacta", () => {
  assert.equal(matchFilms(wd, tmdb).strength, "exact");
});

test("Q-id distinto nunca se fusiona aunque el título coincida", () => {
  const other = { ...tmdb, ids: { wikidata: "Q999" } };
  assert.equal(matchFilms(wd, other).strength, "none");
});

test("sin ids: título + año ±1 + dirección es probable", () => {
  const a = { ...wd, ids: {} };
  const b = { ...tmdb, ids: {} };
  const m = matchFilms(a, b);
  assert.equal(m.strength, "probable");
  assert.equal(m.reason, "título + año + dirección");
});

test("un corto y un largo con el mismo título no se fusionan", () => {
  const short = { ...wd, ids: {}, kind: "short" as const };
  assert.equal(matchFilms(short, { ...tmdb, ids: {} }).strength, "none");
});

test("años muy distintos o dirección distinta no se fusionan (remakes, homónimas)", () => {
  assert.equal(matchFilms({ ...wd, ids: {}, year: 1990 }, { ...tmdb, ids: {} }).strength, "none");
  assert.equal(matchFilms({ ...wd, ids: {}, directors: ["Otra Persona"] }, { ...tmdb, ids: {} }).strength, "none");
});

test("mergeCandidates prefiere Wikidata y registra conflictos", () => {
  const merged = mergeCandidates([tmdb, wd]);
  assert.equal(merged.title, "Sueño de Agua"); // Wikidata gana sobre TMDB
  assert.equal(merged.year, 2025);
  assert.equal(merged.runtimeMinutes, 98); // sólo TMDB lo tiene
  assert.deepEqual(merged.ids, { wikidata: "Q111", tmdb: 42, imdb: null });
  assert.ok(merged.isMexican);
  assert.deepEqual(merged.countries.sort(), ["ES", "MX"]);
  assert.equal(merged.directors.length, 1, "Ana Ruíz y Ana Ruiz son la misma persona");
  assert.ok(merged.conflicts.some((c) => c.field === "year"));
  assert.ok(merged.needsReview);
});

test("un dato editorial verificado tiene precedencia sobre Wikidata", () => {
  const editorial: FilmCandidate = { ...wd, year: 2026, provenance: prov("editorial", "verified") };
  assert.equal(mergeCandidates([wd, editorial]).year, 2026);
});

test("dedupeFilms agrupa por identidad y separa obras distintas", () => {
  const otra: FilmCandidate = {
    title: "Otra película", year: 2024, ids: { wikidata: "Q222" }, provenance: prov("wikidata"),
  };
  const sinIds: FilmCandidate = { ...wd, ids: {}, provenance: prov("editorial", "editorial") };
  const result = dedupeFilms([wd, otra, tmdb, sinIds]);
  assert.equal(result.length, 2);
  const sueño = result.find((r) => r.ids.wikidata === "Q111")!;
  assert.deepEqual(sueño.sources.sort(), ["editorial", "tmdb", "wikidata"]);
  assert.ok(sueño.needsReview, "la coincidencia sin ids queda para revisión");
});
