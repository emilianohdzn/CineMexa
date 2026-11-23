import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./helpers/db.ts";
import { seedFestivals } from "../seed/seed.ts";

test("la siembra de festivales es idempotente y no crea fechas", async () => {
  const db = await freshDb();
  assert.deepEqual(await seedFestivals(db), { inserted: 14, existing: 0 });
  assert.deepEqual(await seedFestivals(db), { inserted: 0, existing: 14 });
  const { rows: [c] } = await db.query<{ editions: number; precise: number }>(
    "select (select count(*)::int from festival_editions) as editions, (select count(*)::int from venues where coordinate_precision <> 'city') as precise");
  assert.deepEqual(c, { editions: 0, precise: 0 });
});

test("las ediciones sembradas llevan fuente, son idempotentes y aplican el cambio de sede de Sundance", async () => {
  const { seedFestivalEditions } = await import("../seed/seed.ts");
  const db = await freshDb();
  await seedFestivals(db);
  const first = await seedFestivalEditions(db);
  assert.equal(first.upserted, 7);
  assert.deepEqual(first.missingFestivals, []);
  assert.equal(first.relocated, 1);
  const again = await seedFestivalEditions(db);
  assert.equal(again.relocated, 0, "la segunda vez no cambia nada");
  const { rows } = await db.query<{ slug: string; starts_on: string; source_url: string; verification: string }>(`
    select f.slug, e.starts_on::text, e.source_url, e.verification::text from festival_editions e join festivals f on f.id = e.festival_id
    order by e.starts_on`);
  assert.equal(rows.length, 7);
  assert.ok(rows.every((r) => r.source_url.startsWith("https://")), "toda edición cita su fuente");
  assert.equal(rows.find((r) => r.slug === "berlinale")!.verification, "verified");
  const { rows: [s] } = await db.query<{ city: string; venue_city: string }>(
    "select f.city, v.city as venue_city from festivals f join venues v on v.id = f.default_venue_id where f.slug = 'sundance'");
  assert.deepEqual(s, { city: "Boulder", venue_city: "Boulder" });
  const { rows: [ev] } = await db.query<{ n: number }>("select count(*)::int as n from festival_events");
  assert.equal(ev.n, 0, "no se inventan selecciones ni proyecciones");
});
