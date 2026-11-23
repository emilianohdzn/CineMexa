// Siembra idempotente de festivales de referencia (sólo identidad y sede a nivel ciudad).
// No crea ediciones, fechas ni participaciones. No modifica filas existentes.
// Uso: npm run seed:festivals  (o con DATABASE_URL en el entorno)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inTransaction, type Db } from "../collectors/lib/db.ts";

interface SeedFestival { slug: string; name: string; short_name: string; city: string; country: string; website_url: string; lat: number; lon: number; focus?: string[] }

export async function seedFestivals(db: Db): Promise<{ inserted: number; existing: number }> {
  const { festivals } = JSON.parse(readFileSync(join(import.meta.dirname, "festivals.json"), "utf8")) as { festivals: SeedFestival[] };
  let inserted = 0;
  await inTransaction(db, async () => {
    for (const f of festivals) {
      const { rows: [venue] } = await db.query<{ id: string }>(
        `insert into venues (name, city, country, latitude, longitude, coordinate_precision, verification, kind)
         values ($1, $2, $3, $4, $5, 'city', 'editorial', 'festival')
         on conflict (name, city, country) do update set name = excluded.name returning id`,
        [f.short_name, f.city, f.country, f.lat, f.lon]);
      const { rows } = await db.query(
        `insert into festivals (slug, name, short_name, city, country, website_url, focus, default_venue_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (slug) do nothing returning id`,
        [f.slug, f.name, f.short_name, f.city, f.country, f.website_url, f.focus ?? [], venue.id]);
      inserted += rows.length;
    }
  });
  return { inserted, existing: festivals.length - inserted };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL.");
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, prepare: false });
  const db: Db = { query: async (q, params = []) => ({ rows: await sql.unsafe(q, params as never[]) as never[] }) };
  console.log(JSON.stringify(await seedFestivals(db)));
  await sql.end();
}
