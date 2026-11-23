import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFilmStatus, editionStatus, inMapPeriod } from "../src/availability.ts";

const now = new Date("2026-11-23T18:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

test("un estreno identificado sin funciones NO es 'en cartelera'", () => {
  assert.equal(classifyFilmStatus({ now, mxReleaseDate: d(-3), confirmedScreenings: [], festivalEvents: [] }), "release_identified");
});

test("una función confirmada próxima sí es 'en cartelera'", () => {
  assert.equal(classifyFilmStatus({ now, mxReleaseDate: d(-3), confirmedScreenings: [{ startsAt: d(1) }], festivalEvents: [] }), "in_theaters");
});

test("funciones pasadas no cuentan como cartelera", () => {
  assert.equal(classifyFilmStatus({ now, confirmedScreenings: [{ startsAt: d(-2) }], festivalEvents: [] }), "archive");
});

test("próximamente y festival", () => {
  assert.equal(classifyFilmStatus({ now, mxReleaseDate: d(20), confirmedScreenings: [], festivalEvents: [] }), "upcoming");
  assert.equal(classifyFilmStatus({ now, confirmedScreenings: [], festivalEvents: [{ date: d(10) }] }), "festival");
});

test("editionStatus con fechas inclusivas y sin fechas", () => {
  assert.equal(editionStatus("2026-11-20", "2026-11-23", "2026-11-23"), "active");
  assert.equal(editionStatus("2026-11-24", "2026-11-30", "2026-11-23"), "upcoming");
  assert.equal(editionStatus("2026-10-01", "2026-10-05", "2026-11-23"), "past");
  assert.equal(editionStatus(null, "2026-10-05", "2026-11-23"), "unconfirmed");
});

test("el mapa nunca muestra eventos sin fecha confirmada", () => {
  assert.equal(inMapPeriod(null, "historic", now), false);
  assert.equal(inMapPeriod(d(3), "week", now), true);
  assert.equal(inMapPeriod(d(-200), "last12", now), true);
  assert.equal(inMapPeriod(d(-200), "upcoming", now), false);
  assert.equal(inMapPeriod(d(5), "historic", now), false);
});
