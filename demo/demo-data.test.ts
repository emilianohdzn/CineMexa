// Verifica que DemoData.json cumpla el contrato que decodifica la app y las reglas de honestidad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const data = JSON.parse(readFileSync(join(import.meta.dirname, "..", "ios", "CineMexa", "Resources", "DemoData.json"), "utf8"));

// Mismo patrón que RelativeDateTokens en CatalogRepository.swift.
const TOKEN = /^(rel|day):([+-]?\d+)([dh])(?:@(\d{2}):(\d{2}))?$/;

function walk(v: unknown, path: string, out: [string, unknown][]) {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, out);
  else out.push([path, v]);
}
const leaves: [string, unknown][] = [];
walk(data, "$", leaves);

test("todas las fechas son tokens válidos y del tipo correcto", () => {
  const dateKeys = /\.(retrieved_at|published_at|generated_at|last_sync_at|starts_at|occurs_at|announced_at|call_deadline|date|computed_at|starts_on|ends_on|mx_release_date)$/;
  for (const [path, v] of leaves) {
    if (typeof v === "string" && /^(rel|day):/.test(v)) assert.match(v, TOKEN, path);
    if (dateKeys.test(path) && v !== null) {
      assert.equal(typeof v, "string", path);
      const calendarDay = /\.(starts_on|ends_on|mx_release_date)$/.test(path);
      assert.ok((v as string).startsWith(calendarDay ? "day:" : "rel:"), `${path} = ${v}`);
    }
  }
});

test("todo el contenido es demo y no hay pósters inventados", () => {
  for (const [path, v] of leaves) if (path.endsWith(".verification")) assert.equal(v, "demo", path);
  for (const f of data.films) {
    assert.equal(f.poster, null);
    assert.equal(f.backdrop, null);
  }
  assert.equal(data.meta.mode, "demo");
});

test("campos obligatorios del contrato (modelos Swift no opcionales)", () => {
  const req: Record<string, string[]> = {
    films: ["id", "slug", "title", "alt_titles", "kind", "countries", "mx_participation", "genres", "is_documentary", "is_animation", "directors", "writers", "cinematographers", "cast", "status", "provenance"],
    screenings: ["id", "film_id", "venue", "kind", "starts_at", "provenance"],
    reviews: ["id", "film_id", "outlet", "title", "url", "published_at", "is_automated_summary", "provenance"],
    timeline: ["id", "film_id", "kind", "date", "label", "provenance"],
    festivals: ["id", "slug", "name", "city", "country", "focus", "venue", "editions", "provenance"],
    festival_events: ["id", "edition_id", "festival_id", "film_id", "kind", "provenance"],
    news: ["id", "kind", "title", "url", "published_at", "provenance"],
    trends: ["window", "computed_at", "label", "sources_used", "methodology_version", "entries", "history"],
  };
  for (const [coll, keys] of Object.entries(req)) {
    assert.ok(Array.isArray(data[coll]), coll);
    for (const item of data[coll]) for (const k of keys) assert.ok(item[k] !== undefined && item[k] !== null, `${coll}.${k} en ${item.id ?? item.window}`);
  }
});

test("las referencias entre colecciones existen", () => {
  const films = new Set(data.films.map((f: any) => f.id));
  const festivals = new Set(data.festivals.map((f: any) => f.id));
  const editions = new Set(data.festivals.flatMap((f: any) => f.editions.map((e: any) => e.id)));
  for (const coll of ["screenings", "reviews", "timeline", "festival_events", "streaming"]) {
    for (const x of data[coll]) assert.ok(films.has(x.film_id), `${coll} → ${x.film_id}`);
  }
  for (const e of data.festival_events) {
    assert.ok(festivals.has(e.festival_id));
    assert.ok(editions.has(e.edition_id));
  }
  for (const t of data.trends) for (const e of t.entries) assert.ok(films.has(e.film_id));
});

test("reseñas: puntuación sólo con escala y nunca más de cinco en tendencias", () => {
  for (const r of data.reviews) if (r.score !== null) assert.ok(r.score_scale !== null && r.score <= r.score_scale);
  for (const t of data.trends) assert.ok(t.entries.length <= 5);
});

test("cortometrajes con la misma presencia: hay cortos en festivales y en tendencias", () => {
  const shorts = new Set(data.films.filter((f: any) => f.kind === "short").map((f: any) => f.id));
  assert.ok(shorts.size >= 3);
  assert.ok(data.festival_events.some((e: any) => shorts.has(e.film_id)));
  assert.ok(data.trends.some((t: any) => t.entries.some((e: any) => shorts.has(e.film_id))));
});
