import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMexicanProduction, normalizeCountry, normalizeImdbId, normalizePersonName,
  normalizeTitle, normalizeWikidataId,
} from "../src/normalize.ts";

test("normalizeTitle quita acentos, signos y artículo inicial", () => {
  assert.equal(normalizeTitle("¡Ya no estoy aquí!"), "ya no estoy aqui");
  assert.equal(normalizeTitle("El Laberinto del Fauno"), "laberinto del fauno");
  assert.equal(normalizeTitle("  LOS   Olvidados "), "olvidados");
  assert.equal(normalizeTitle("Amores perros"), normalizeTitle("AMORES PERROS"));
  assert.equal(normalizeTitle("Roma & Ciudad"), "roma y ciudad");
});

test("normalizeTitle no deja vacío un título de una sola palabra que es artículo", () => {
  assert.equal(normalizeTitle("La"), "la");
});

test("normalizePersonName compara nombres con y sin acentos o iniciales", () => {
  assert.equal(normalizePersonName("Alfonso Cuarón"), normalizePersonName("alfonso cuaron"));
  assert.equal(normalizePersonName("Guillermo del Toro"), "guillermo del toro");
  assert.equal(normalizePersonName("J. Pérez-Gómez"), "perez gomez");
});

test("normalizeCountry acepta nombre, ISO y Q-id", () => {
  assert.equal(normalizeCountry("México"), "MX");
  assert.equal(normalizeCountry("Q96"), "MX");
  assert.equal(normalizeCountry("fr"), "FR");
  assert.equal(normalizeCountry("Narnia"), null);
});

test("isMexicanProduction detecta coproducciones", () => {
  assert.ok(isMexicanProduction(["ES", "Mexico"]));
  assert.ok(!isMexicanProduction(["US", "CA"]));
  assert.ok(!isMexicanProduction(undefined));
});

test("identificadores externos", () => {
  assert.equal(normalizeWikidataId("http://www.wikidata.org/entity/Q12345"), "Q12345");
  assert.equal(normalizeWikidataId("wd:q7"), "Q7");
  assert.equal(normalizeWikidataId("Q0"), null);
  assert.equal(normalizeImdbId("https://www.imdb.com/title/tt0245712/"), "tt0245712");
  assert.equal(normalizeImdbId("nada"), null);
});
