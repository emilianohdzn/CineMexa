// Mexa, Fase A: respuestas con fuente desde los datos publicables, sin modelo y sin inventar.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, type TestDb } from "./helpers/db.ts";
import { seedFestivals, seedFestivalEditions } from "../seed/seed.ts";
import { handleMexa, resetMexaState } from "../mexa/handler.ts";

const NOW = new Date("2026-11-23T15:00:00Z");
let db: TestDb;
const ids: Record<string, string> = {};

async function film(slug: string, title: string, year: number, director: string | null, extra: { release?: string; published?: boolean } = {}) {
  const { rows: [f] } = await db.query<{ id: string }>(
    "insert into films (slug, title, year, published, mx_release_date) values ($1, $2, $3, $4, $5) returning id::text",
    [slug, title, year, extra.published ?? true, extra.release ?? null]);
  if (director) {
    const { rows: [p] } = await db.query<{ id: string }>("insert into people (name, name_key) values ($1, lower($1)) returning id::text", [director]);
    await db.query("insert into film_credits (film_id, person_id, role) values ($1, $2, 'director')", [f.id, p.id]);
  }
  ids[slug] = f.id;
}

before(async () => {
  db = await freshDb();
  await seedFestivals(db);
  await seedFestivalEditions(db);
  await film("el-jockey", "El jockey", 2024, "Luis Ortega", { release: "2026-12-04" });
  await film("macula-a", "Mácula", 2025, "Pedro Gómez");
  await film("macula-b", "Mácula", 2025, "Ana Ruiz");
  await film("sombra", "La sombra del mezquite", 2025, "Laura Ríos");
  await film("oculta", "Película oculta", 2025, "Nadie Nunca", { published: false, release: "2026-12-01" });
  const { rows: [ed] } = await db.query<{ id: string }>(`
    insert into festival_editions (festival_id, edition_label, year, starts_on, ends_on, source_id, source_url, verification)
    select id, '72ª edición', 2024, '2024-09-20', '2024-09-28', 'editorial', 'https://example.org/ssiff-2024', 'editorial'
    from festivals where slug = 'san-sebastian' returning id::text`);
  await db.query(`insert into festival_events (edition_id, film_id, kind, award_name, source_id, source_url, verification)
    values ($1, $2, 'award', 'Horizontes Latinos', 'wikidata', 'https://example.org/premio', 'automatic')`, [ed.id, ids["el-jockey"]]);
});

async function ask(question: string) {
  const res = await handleMexa(new Request("https://x.test/mexa", { method: "POST", body: JSON.stringify({ question }) }), { db, now: () => NOW, cacheSeconds: 0, perMinute: 0 });
  assert.equal(res.status, 200);
  return res.json() as Promise<any>;
}

test("quién dirigió: responde con la película como fuente", async () => {
  const a = await ask("¿Quién dirigió El jockey?");
  assert.equal(a.intent, "film_director");
  assert.match(a.text, /Luis Ortega/);
  assert.equal(a.citations[0].id, ids["el-jockey"]);
});

test("dos películas con el mismo título: pregunta cuál en vez de adivinar", async () => {
  const a = await ask("quién dirigió Mácula");
  assert.equal(a.intent, "clarify");
  assert.equal(a.options.length, 2);
  assert.ok(a.options.some((o: any) => /Pedro Gómez/.test(o.label)));
});

test("películas de un director y de un año", async () => {
  const d = await ask("películas de Laura Ríos");
  assert.equal(d.intent, "director_films");
  assert.deepEqual(d.items.map((i: any) => i.film_id), [ids.sombra]);
  const y = await ask("Películas de 2025");
  assert.equal(y.intent, "year_films");
  assert.equal(y.items.length, 3, "la no publicada no aparece (RLS)");
});

test("premios en un festival, con la URL de la fuente", async () => {
  const a = await ask("Premios en San Sebastián");
  assert.equal(a.intent, "festival_awards");
  assert.match(a.text, /El jockey, Horizontes Latinos \(2024\)/);
  assert.equal(a.citations[0].url, "https://example.org/premio");
});

test("fechas de festival: la próxima edición con fuente, o lo dice si no hay", async () => {
  const b = await ask("¿Cuándo es la Berlinale?");
  assert.equal(b.intent, "festival_dates");
  assert.match(b.text, /del 10 al 21 de febrero de 2027/);
  assert.match(b.citations[0].url, /^https:\/\//);
  const g = await ask("¿cuándo es el GIFF?");
  assert.equal(g.unanswered, "sin_fecha");
});

test("próximos estrenos sin funciones inventadas ni películas ocultas", async () => {
  const a = await ask("próximos estrenos");
  assert.equal(a.intent, "upcoming");
  assert.deepEqual(a.items.map((i: any) => i.film_id), [ids["el-jockey"]]);
  assert.match(a.text, /no implica funciones/);
});

test("tendencias sin evidencia: lo dice, no simula", async () => {
  const a = await ask("¿Qué está en tendencia?");
  assert.equal(a.unanswered, "sin_evidencia");
  assert.deepEqual(a.items, []);
  assert.doesNotMatch(a.text, /dos mediciones/);
});

test("límite por cliente: 429 con retry-after y otro cliente sigue pasando", async () => {
  resetMexaState();
  const call = (ip: string) => handleMexa(new Request("https://x.test/mexa?q=pr%C3%B3ximos%20estrenos", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } }),
    { db, now: () => NOW, perMinute: 2 });
  assert.equal((await call("1.1.1.1")).status, 200);
  assert.equal((await call("1.1.1.1")).status, 200);
  const third = await call("1.1.1.1");
  assert.equal(third.status, 429);
  assert.equal(third.headers.get("retry-after"), "60");
  assert.equal((await call("2.2.2.2")).status, 200);
  resetMexaState();
});

test("fechas en español de México", async () => {
  const { fecha, rango } = await import("../mexa/answer.ts");
  assert.equal(fecha("2026-12-04"), "4 de diciembre de 2026");
  assert.equal(rango("2027-02-10", "2027-02-21"), "del 10 al 21 de febrero de 2027");
  assert.equal(rango("2026-10-28", "2026-11-03"), "del 28 de octubre al 3 de noviembre de 2026");
  assert.equal(rango("2026-12-28", "2027-01-03"), "del 28 de diciembre de 2026 al 3 de enero de 2027");
});

test("fuera de alcance o pregunta inválida", async () => {
  const a = await ask("¿Cuál es la mejor película de la historia?");
  assert.equal(a.intent, "unknown");
  assert.equal(a.citations.length, 0);
  const bad = await handleMexa(new Request("https://x.test/mexa?q=a"), { db, now: () => NOW });
  assert.equal(bad.status, 400);
  const put = await handleMexa(new Request("https://x.test/mexa", { method: "PUT" }), { db, now: () => NOW });
  assert.equal(put.status, 405);
});
