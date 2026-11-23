import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTrendRanking, rankingLabel, robustZ, toIndex } from "../src/trendScore.ts";
import type { TrendObservation } from "../src/types.ts";

const NOW = new Date("2026-11-23T00:00:00Z");
const DAY = 86_400_000;

/** Genera observaciones diarias: base por día y valor en los últimos 7 días. */
function series(filmId: string, source: string, baselinePerDay: number, currentPerDay: number, days = 28): TrendObservation[] {
  const out: TrendObservation[] = [];
  for (let d = days; d >= 1; d--) {
    const t = new Date(NOW.getTime() - d * DAY);
    out.push({ filmId, source, metric: "x", observedAt: t.toISOString(), value: d <= 7 ? currentPerDay : baselinePerDay });
  }
  return out;
}

test("el crecimiento relativo vence al tamaño histórico", () => {
  const obs = [
    ...series("blockbuster", "youtube", 100_000, 100_000), // enorme pero plano
    ...series("revelacion", "youtube", 300, 3_000), // pequeña pero x10
    ...series("media", "youtube", 5_000, 6_000),
    ...series("estable", "youtube", 2_000, 2_000),
  ];
  const r = computeTrendRanking(obs, { window: "7d", now: NOW });
  assert.equal(r.entries[0].filmId, "revelacion");
  assert.ok(r.entries.findIndex((e) => e.filmId === "blockbuster") > 0);
});

test("sin evidencia mínima una película no entra aunque crezca", () => {
  const obs = [
    ...series("diminuta", "youtube", 1, 50), // crece x50 pero sólo 350 vistas < 500
    ...series("ok", "youtube", 1_000, 1_200),
  ];
  const r = computeTrendRanking(obs, { window: "7d", now: NOW });
  assert.deepEqual(r.entries.map((e) => e.filmId), ["ok"]);
});

test("si hay menos de cinco películas verificables, no se rellena", () => {
  const obs = [...series("a", "youtube", 1_000, 2_000), ...series("b", "youtube", 1_000, 1_500)];
  const r = computeTrendRanking(obs, { window: "7d", now: NOW });
  assert.equal(r.entries.length, 2);
});

test("los medios por sí solos no hacen elegible a una película (señal separada)", () => {
  const obs = [...series("solo-prensa", "media", 0, 10), ...series("con-video", "youtube", 1_000, 1_100)];
  const r = computeTrendRanking(obs, { window: "7d", now: NOW });
  assert.ok(!r.entries.some((e) => e.filmId === "solo-prensa"));
});

test("etiqueta y fuentes usadas son honestas", () => {
  const obs = [...series("a", "youtube", 1_000, 2_000), ...series("a", "media", 1, 4)];
  const r = computeTrendRanking(obs, { window: "7d", now: NOW });
  assert.equal(r.label, "Tendencias digitales");
  assert.deepEqual(r.sourcesUsed.sort(), ["media", "youtube"]);
  assert.equal(rankingLabel(["youtube", "google_trends"]), "Las 5 que están dando de qué hablar");
});

test("la explicación cita la señal que más aportó", () => {
  const obs = [...series("a", "youtube", 1_000, 3_000), ...series("b", "youtube", 1_000, 1_000)];
  const r = computeTrendRanking(obs, { window: "7d", now: NOW });
  assert.match(r.entries[0].explanation, /^YouTube: visualizaciones \+200% frente al periodo anterior\.$/);
});

test("previousRank refleja el ranking de la ventana anterior", () => {
  // "sube" sólo crece en la última semana; "bajaba" creció la semana anterior.
  const obs: TrendObservation[] = [];
  for (let d = 35; d >= 1; d--) {
    const t = new Date(NOW.getTime() - d * DAY).toISOString();
    obs.push({ filmId: "sube", source: "youtube", metric: "x", observedAt: t, value: d <= 7 ? 5_000 : 1_000 });
    obs.push({ filmId: "bajaba", source: "youtube", metric: "x", observedAt: t, value: d > 7 && d <= 14 ? 5_000 : 1_000 });
    obs.push({ filmId: "plana", source: "youtube", metric: "x", observedAt: t, value: 1_000 });
  }
  const r = computeTrendRanking(obs, { window: "7d", now: NOW });
  const sube = r.entries.find((e) => e.filmId === "sube")!;
  assert.equal(sube.rank, 1);
  assert.ok(sube.previousRank !== null && sube.previousRank > 1);
});

test("es determinista y el índice está en 0..100", () => {
  const obs = [...series("a", "youtube", 1_000, 2_000), ...series("b", "youtube", 1_000, 1_500)];
  const r1 = computeTrendRanking(obs, { window: "7d", now: NOW });
  const r2 = computeTrendRanking([...obs].reverse(), { window: "7d", now: NOW });
  assert.deepEqual(r1, r2);
  for (const e of r1.entries) assert.ok(e.score >= 0 && e.score <= 100);
  assert.equal(toIndex(0), 50);
});

test("robustZ maneja valores idénticos sin NaN", () => {
  assert.deepEqual(robustZ([3, 3, 3]), [0, 0, 0]);
  assert.ok(robustZ([1, 2, 100]).every(Number.isFinite));
});
