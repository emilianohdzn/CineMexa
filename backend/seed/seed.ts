// Siembra idempotente de festivales de referencia (identidad y sede a nivel ciudad) y de las ediciones cuyas fechas
// ya publicó el festival, cada una con su fuente (seed/festival-editions.json). No crea selecciones ni proyecciones.
// Uso: npm run seed:festivals  (o con DATABASE_URL en el entorno)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inTransaction, openPostgres, type Db } from "../collectors/lib/db.ts";

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

interface SeedEdition { festival: string; label: string; year: number; starts_on: string; ends_on: string; timezone: string; source_url: string; verification: "verified" | "editorial" }
interface Relocation { festival: string; city: string; country: string; lat: number; lon: number; from_year: number; source_url: string }

/** Ediciones con fecha publicada. Idempotente: actualiza fechas y fuente si cambian; nunca borra. */
export async function seedFestivalEditions(db: Db): Promise<{ upserted: number; relocated: number; missingFestivals: string[] }> {
  const data = JSON.parse(readFileSync(join(import.meta.dirname, "festival-editions.json"), "utf8")) as
    { retrieved_at: string; editions: SeedEdition[]; relocations: Relocation[] };
  let upserted = 0, relocated = 0;
  const missingFestivals: string[] = [];
  await inTransaction(db, async () => {
    for (const e of data.editions) {
      const { rows: [fest] } = await db.query<{ id: string }>("select id from festivals where slug = $1", [e.festival]);
      if (!fest) { missingFestivals.push(e.festival); continue; }
      await db.query(
        `insert into festival_editions (festival_id, edition_label, year, starts_on, ends_on, timezone, source_id, source_url, verification, retrieved_at)
         values ($1, $2, $3, $4, $5, $6, 'editorial', $7, $8, $9)
         on conflict (festival_id, year, edition_label) do update set starts_on = excluded.starts_on, ends_on = excluded.ends_on,
           timezone = excluded.timezone, source_url = excluded.source_url, verification = excluded.verification,
           retrieved_at = excluded.retrieved_at, updated_at = now()`,
        [fest.id, e.label, e.year, e.starts_on, e.ends_on, e.timezone, e.source_url, e.verification, data.retrieved_at]);
      upserted++;
    }
    // Cambio de sede documentado por el festival (p. ej. Sundance pasa a Boulder desde 2027).
    for (const r of data.relocations) {
      const { rows: [venue] } = await db.query<{ id: string }>(
        `insert into venues (name, city, country, latitude, longitude, coordinate_precision, verification, kind)
         select short_name, $2, $3, $4, $5, 'city', 'editorial', 'festival' from festivals where slug = $1
         on conflict (name, city, country) do update set latitude = excluded.latitude, longitude = excluded.longitude returning id`,
        [r.festival, r.city, r.country, r.lat, r.lon]);
      if (!venue) continue;
      const { rows } = await db.query(
        `update festivals set city = $2, country = $3, default_venue_id = $4, updated_at = now()
         where slug = $1 and (city <> $2 or default_venue_id is distinct from $4) returning id`, [r.festival, r.city, r.country, venue.id]);
      relocated += rows.length;
    }
  });
  return { upserted, relocated, missingFestivals };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL.");
  const { db, end } = await openPostgres(url);
  console.log(JSON.stringify({ festivales: await seedFestivals(db), ediciones: await seedFestivalEditions(db) }));
  await end();
}
