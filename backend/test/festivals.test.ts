// Conector de festivales de Wikidata: identidad por dominio, ediciones con fecha y premios con referencia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./helpers/db.ts";
import { seedFestivals, seedFestivalEditions } from "../seed/seed.ts";
import { activityQuery, editionsQuery, festivalIdentityQuery, parseActivity, runWikidataFestivals } from "../collectors/wikidata/festivals.ts";

const UA = "CineMexaBot/0.1 (https://github.com/emilianohdzn/CineMexa)";
const WD = "http://www.wikidata.org/entity/";
const json = (bindings: unknown[]) => new Response(JSON.stringify({ results: { bindings } }), { headers: { "content-type": "application/json" } });
const v = (value: string) => ({ value });

function fakeWikidata() {
  const queries: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const q = decodeURIComponent(String(url).split("query=")[1] ?? "");
    queries.push(q);
    if (q.includes("Q220505")) return json([
      { fest: v(`${WD}Q130871`), site: v("https://www.berlinale.de/en/") },          // Berlinale: un candidato
      { fest: v(`${WD}Q42369`), site: v("https://www.festival-cannes.com/") },         // Cannes: dos candidatos → no se vincula
      { fest: v(`${WD}Q999001`), site: v("https://www.festival-cannes.com/fr/") },
      { fest: v(`${WD}Q999002`), site: v("https://berlinale.de.example.org/") },        // otro dominio: se ignora
    ]);
    if (q.includes("P580")) return json([
      { fest: v(`${WD}Q130871`), ed: v(`${WD}Q500077`), start: v("2027-02-10T00:00:00Z"), end: v("2027-02-21T00:00:00Z"), num: v("77") },
      { fest: v(`${WD}Q130871`), ed: v(`${WD}Q500076`), start: v("2026-02-12T00:00:00Z"), end: v("2026-02-22T00:00:00Z"), num: v("76") },
    ]);
    if (q.includes("P1411")) return json([
      // Premio con referencia, película conocida, edición 2026 (creada desde Wikidata).
      { st: v(`${WD}statement/Q700001-AAA`), film: v(`${WD}Q700001`), kind: v("award"), award: v(`${WD}Q1`), awardLabel: v("Oso de Plata"),
        fest: v(`${WD}Q130871`), time: v("2026-02-21T00:00:00Z"), ref: v("https://www.berlinale.de/en/archive/prizes.html") },
      // Nominación en 2023: no hay edición 2023 → no se crea nada.
      { st: v(`${WD}statement/Q700001-BBB`), film: v(`${WD}Q700001`), kind: v("nomination"), award: v(`${WD}Q2`), awardLabel: v("Oso de Oro"),
        fest: v(`${WD}Q130871`), time: v("2023-02-20T00:00:00Z") },
      // Película que no está en el catálogo.
      { st: v(`${WD}statement/Q799999-CCC`), film: v(`${WD}Q799999`), kind: v("award"), award: v(`${WD}Q1`), awardLabel: v("Oso de Plata"),
        fest: v(`${WD}Q130871`), time: v("2026-02-21T00:00:00Z") },
      // Premio sin etiqueta legible: se descarta.
      { st: v(`${WD}statement/Q700001-DDD`), film: v(`${WD}Q700001`), kind: v("award"), award: v(`${WD}Q3`), awardLabel: v("Q3"),
        fest: v(`${WD}Q130871`), time: v("2026-02-21T00:00:00Z") },
    ]);
    return new Response("consulta inesperada", { status: 400 });
  }) as typeof fetch;
  return { fetchImpl, queries };
}

test("las consultas exigen dominio, fecha de inicio y referencia", () => {
  const id = festivalIdentityQuery(["berlinale.de", 'x"); DROP']);
  assert.match(id, /CONTAINS\(LCASE\(STR\(\?site\)\), "berlinale.de"\)/);
  assert.ok(!id.includes('"x");'), "el dominio se limpia antes de entrar a la consulta");
  assert.match(id, /FILTER NOT EXISTS \{ \?fest wdt:P179/);
  assert.match(editionsQuery(["Q1"], 2024), /wdt:P580 \?start/);
  const act = activityQuery(["Q1"], 2024);
  assert.match(act, /prov:wasDerivedFrom/);
  assert.match(act, /wdt:P495 wd:Q96/);
  assert.equal(parseActivity({ results: { bindings: [{ st: v("x/S1"), film: v(`${WD}Q1`), fest: v(`${WD}Q2`), kind: v("award"), awardLabel: v("Q9"), time: v("2026-01-01") }] } }).length, 0);
});

test("vincula sólo con dominio único, crea ediciones sin pisar las editoriales y registra premios con evidencia", async () => {
  const db = await freshDb();
  await seedFestivals(db);
  await seedFestivalEditions(db);
  const { rows: [film] } = await db.query<{ id: string }>(
    "insert into films (slug, title, year, published) values ('pelicula-premiada', 'Película premiada', 2026, true) returning id::text");
  await db.query("insert into film_external_ids (film_id, provider, external_id, source_id) values ($1, 'wikidata', 'Q700001', 'wikidata')", [film.id]);

  const { fetchImpl } = fakeWikidata();
  const r = await runWikidataFestivals(db, { userAgent: UA, http: { fetchImpl, retries: 0 } });
  assert.equal(r.status, "succeeded", r.errors.join("\n"));
  assert.deepEqual(r.counts, { linked: 1, editions: 1, events: 1, skippedNoEdition: 1, skippedNoFilm: 1 });

  const { rows: linked } = await db.query<{ slug: string; wikidata_id: string }>("select slug, wikidata_id from festivals where wikidata_id is not null");
  assert.deepEqual(linked, [{ slug: "berlinale", wikidata_id: "Q130871" }], "Cannes tiene dos candidatos: no se adivina");

  const { rows: eds } = await db.query<{ year: number; source_id: string; edition_label: string; starts_on: string }>(`
    select e.year, e.source_id, e.edition_label, e.starts_on::text from festival_editions e join festivals f on f.id = e.festival_id
    where f.slug = 'berlinale' order by e.year`);
  assert.deepEqual(eds, [
    { year: 2025, source_id: "editorial", edition_label: "75ª edición", starts_on: "2025-02-13" },
    { year: 2026, source_id: "wikidata", edition_label: "76ª edición", starts_on: "2026-02-12" },
    { year: 2027, source_id: "editorial", edition_label: "77ª edición", starts_on: "2027-02-10" },
  ], "la edición 2027 ya tenía fuente editorial y no se toca");

  const { rows: evs } = await db.query<{ kind: string; award_name: string; source_url: string; verification: string; year: number }>(`
    select ev.kind::text, ev.award_name, ev.source_url, ev.verification::text, e.year
    from festival_events ev join festival_editions e on e.id = ev.edition_id`);
  assert.deepEqual(evs, [{ kind: "award", award_name: "Oso de Plata", source_url: "https://www.berlinale.de/en/archive/prizes.html", verification: "automatic", year: 2026 }]);

  // Segunda corrida: nada cambia ni se duplica.
  const again = await runWikidataFestivals(db, { userAgent: UA, http: { fetchImpl, retries: 0 } });
  assert.equal(again.status, "succeeded");
  assert.deepEqual({ ...again.counts }, { linked: 0, editions: 0, events: 0, skippedNoEdition: 1, skippedNoFilm: 1 });
  const { rows: [n] } = await db.query<{ n: number }>("select count(*)::int as n from festival_events");
  assert.equal(n.n, 1);
});

test("sin user agent identificable no consulta Wikidata", async () => {
  const db = await freshDb();
  await assert.rejects(runWikidataFestivals(db, { userAgent: "definir" }), /WIKIDATA_USER_AGENT/);
});

test("si la consulta de premios falla, la identidad y las ediciones se conservan y la corrida queda parcial", async () => {
  const db = await freshDb();
  await seedFestivals(db);
  const { fetchImpl: base } = fakeWikidata();
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (decodeURIComponent(String(url)).includes("P1411")) return new Response("upstream request timeout", { status: 504 });
    return base(url, init);
  }) as typeof fetch;
  const r = await runWikidataFestivals(db, { userAgent: UA, http: { fetchImpl, retries: 0 } });
  assert.equal(r.status, "partial");
  assert.equal(r.counts.linked, 1);
  assert.equal(r.counts.editions, 2);
  assert.match(r.warnings.join(), /Actividad no consultada: HTTP 504/);
});
