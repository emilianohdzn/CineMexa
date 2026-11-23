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
