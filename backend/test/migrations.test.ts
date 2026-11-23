// Aplica las migraciones sobre un Postgres real embebido (PGlite) que imita los roles
// de Supabase (anon, authenticated, service_role) y la función auth.uid().
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const MIGRATIONS = join(import.meta.dirname, "..", "supabase", "migrations");
let db: PGlite;

const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

async function as<T>(role: "anon" | "authenticated" | "service_role", sub: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false);`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
}

const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";
const EDITOR = "00000000-0000-0000-0000-0000000000ed";

before(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_SHIM);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  await db.exec(`
    insert into staff (user_id, role) values ('${EDITOR}', 'editor');
    insert into films (id, slug, title, year, countries, published, verification) values
      ('10000000-0000-0000-0000-000000000001', 'publicada', 'Publicada', 2026, '{MX}', true, 'verified'),
      ('10000000-0000-0000-0000-000000000002', 'borrador', 'Borrador', 2026, '{MX}', false, 'automatic');
  `);
});

test("las migraciones crean todas las entidades requeridas", async () => {
  const { rows } = await db.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public'");
  const names = rows.map((r) => r.table_name);
  for (const t of ["films", "film_external_ids", "film_images", "people", "film_credits", "festivals",
    "festival_editions", "festival_events", "venues", "screenings", "reviews", "trend_signals",
    "trend_snapshots", "news_items", "sources", "source_records", "ingestion_runs", "user_favorites", "user_alerts"]) {
    assert.ok(names.includes(t), `falta ${t}`);
  }
});

test("RLS está activo en todas las tablas públicas", async () => {
  const { rows } = await db.query<{ relname: string }>(
    "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
  assert.deepEqual(rows, []);
});

test("anon sólo lee películas publicadas", async () => {
  const rows = await as("anon", null, () => db.query<{ slug: string }>("select slug from films order by slug"));
  assert.deepEqual(rows.rows.map((r) => r.slug), ["publicada"]);
});

test("anon no puede escribir", async () => {
  await assert.rejects(as("anon", null, () => db.query("insert into films (slug, title) values ('x', 'X')")));
});

test("anon no ve registros crudos ni corridas de ingesta", async () => {
  await db.exec("insert into ingestion_runs (source_id, job) values ('wikidata', 'discover_films')");
  const r = await as("anon", null, () => db.query("select * from ingestion_runs"));
  assert.equal(r.rows.length, 0);
});

test("cada usuario sólo ve sus favoritos", async () => {
  await as("authenticated", USER_A, () => db.query(
    "insert into user_favorites (user_id, entity_type, entity_id) values ($1, 'film', '10000000-0000-0000-0000-000000000001')", [USER_A]));
  await assert.rejects(as("authenticated", USER_A, () => db.query(
    "insert into user_favorites (user_id, entity_type, entity_id) values ($1, 'film', '10000000-0000-0000-0000-000000000001')", [USER_B])));
  const b = await as("authenticated", USER_B, () => db.query("select * from user_favorites"));
  assert.equal(b.rows.length, 0);
  const a = await as("authenticated", USER_A, () => db.query("select * from user_favorites"));
  assert.equal(a.rows.length, 1);
});

test("un editor del staff ve borradores y puede corregir", async () => {
  const r = await as("authenticated", EDITOR, () => db.query("select slug from films"));
  assert.equal(r.rows.length, 2);
  await as("authenticated", EDITOR, () => db.query("update films set needs_review = true where slug = 'borrador'"));
  const plain = await as("authenticated", USER_A, () => db.query("update films set title = 'hack' where slug = 'publicada' returning id"));
  assert.equal(plain.rows.length, 0, "un usuario común no puede modificar películas");
});

test("un id externo sólo puede pertenecer a una película", async () => {
  await db.exec("insert into film_external_ids (film_id, provider, external_id, is_canonical) values ('10000000-0000-0000-0000-000000000001', 'wikidata', 'Q1', true)");
  await assert.rejects(db.query("insert into film_external_ids (film_id, provider, external_id) values ('10000000-0000-0000-0000-000000000002', 'wikidata', 'Q1')"));
});

test("puntuaciones y extractos de reseñas requieren licencia", async () => {
  const base = "insert into reviews (film_id, outlet, title, url, published_at, source_id";
  await assert.rejects(db.query(`${base}, score, score_scale) values ('10000000-0000-0000-0000-000000000001', 'Medio', 'T', 'https://e.x/1', now(), 'editorial', 8, 10)`));
  await assert.rejects(db.query(`${base}, excerpt) values ('10000000-0000-0000-0000-000000000001', 'Medio', 'T', 'https://e.x/2', now(), 'editorial', 'texto')`));
  await db.query(`${base}, score, score_scale, score_licensed) values ('10000000-0000-0000-0000-000000000001', 'Medio', 'T', 'https://e.x/3', now(), 'editorial', 8, 10, true)`);
});

test("restricciones de fechas, coordenadas y países", async () => {
  await assert.rejects(db.query("insert into films (slug, title, countries) values ('mal', 'Mal', '{Mexico}')"));
  await assert.rejects(db.query("insert into venues (name, city, country, latitude, longitude) values ('X', 'Y', 'MX', 200, 0)"));
  const { rows } = await db.query<{ id: string }>("insert into festivals (slug, name, city, country) values ('ficm', 'FICM', 'Morelia', 'MX') returning id");
  await assert.rejects(db.query("insert into festival_editions (festival_id, edition_label, year, starts_on, ends_on, source_id) values ($1, '2026', 2026, '2026-10-20', '2026-10-10', 'editorial')", [rows[0].id]));
});

test("un premio requiere nombre de premio", async () => {
  const f = await db.query<{ id: string }>("insert into festivals (slug, name, city, country) values ('giff', 'GIFF', 'Guanajuato', 'MX') returning id");
  const e = await db.query<{ id: string }>("insert into festival_editions (festival_id, edition_label, year, source_id) values ($1, '2026', 2026, 'editorial') returning id", [f.rows[0].id]);
  await assert.rejects(db.query("insert into festival_events (edition_id, film_id, kind, source_id) values ($1, '10000000-0000-0000-0000-000000000001', 'award', 'editorial')", [e.rows[0].id]));
});

test("búsqueda por similitud de título (pg_trgm)", async () => {
  const r = await db.query<{ slug: string }>("select slug from films where title % 'Publicadaa'");
  assert.deepEqual(r.rows.map((x) => x.slug), ["publicada"]);
});
