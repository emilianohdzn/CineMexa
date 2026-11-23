// Enriquecimiento con TMDB de películas ya identificadas (tienen id de TMDB, normalmente vía Wikidata).
// Reglas: no se sobrescriben campos de películas 'verified'/'editorial' (sólo huecos); el póster de TMDB
// se guarda con su atribución y no reemplaza un póster oficial; el estreno en México sólo si TMDB lo da para MX.
import { normalizePersonName } from "../../../packages/core/src/index.ts";
import { inTransaction, type Db } from "../lib/db.ts";
import { linkSourceRecord, recordSource } from "../lib/runs.ts";
import { TMDB_ATTRIBUTION, type TmdbEnrichment } from "./parse.ts";

const SOURCE = "tmdb";

export async function applyTmdb(db: Db, filmId: string, e: TmdbEnrichment, runId: string): Promise<"updated" | "unchanged"> {
  return inTransaction(db, async () => {
    const { changed } = await recordSource(db, {
      sourceId: SOURCE, entityType: "film", externalId: String(e.tmdbId), sourceUrl: e.sourceUrl, payload: e, runId,
    });
    await linkSourceRecord(db, SOURCE, "film", String(e.tmdbId), filmId);
    if (!changed) return "unchanged";

    const { rows: [film] } = await db.query<{ verification: string }>("select verification::text as verification from films where id = $1", [filmId]);
    const curated = film.verification === "verified" || film.verification === "editorial";
    await db.query(
      curated
        ? `update films set synopsis = coalesce(synopsis, $2), synopsis_source_id = case when synopsis is null and $2::text is not null then 'tmdb' else synopsis_source_id end,
             runtime_minutes = coalesce(runtime_minutes, $3), mx_release_date = coalesce(mx_release_date, $4::date),
             trailer_url = coalesce(trailer_url, $5) where id = $1`
        : `update films set synopsis = coalesce($2, synopsis), synopsis_source_id = case when $2::text is not null then 'tmdb' else synopsis_source_id end,
             runtime_minutes = coalesce($3, runtime_minutes), mx_release_date = coalesce($4::date, mx_release_date),
             trailer_url = coalesce($5, trailer_url) where id = $1`,
      [filmId, e.synopsis, e.runtimeMinutes, e.mxReleaseDate, e.trailerUrl],
    );

    if (e.imdbId) {
      await db.query(
        `insert into film_external_ids (film_id, provider, external_id, source_id) values ($1, 'imdb', $2, 'tmdb')
         on conflict do nothing`, [filmId, e.imdbId]);
    }

    for (const [kind, img] of [["poster", e.poster], ["backdrop", e.backdrop]] as const) {
      if (!img) continue;
      const { rows: primary } = await db.query<{ source_id: string; url: string }>(
        "select source_id, url from film_images where film_id = $1 and kind = $2 and is_primary", [filmId, kind]);
      // Un póster primario de otra fuente (oficial/editorial) se respeta.
      const takePrimary = primary.length === 0 || primary[0].source_id === SOURCE;
      if (takePrimary && primary[0] && primary[0].url !== img.url) {
        await db.query("update film_images set is_primary = false where film_id = $1 and kind = $2 and is_primary", [filmId, kind]);
      }
      await db.query(
        `insert into film_images (film_id, kind, url, source_id, source_url, attribution, is_official, is_primary)
         values ($1, $2, $3, 'tmdb', $4, $5, false, $6)
         on conflict (film_id, kind, url) do update set is_primary = excluded.is_primary, retrieved_at = now()`,
        [filmId, kind, img.url, e.sourceUrl, TMDB_ATTRIBUTION, takePrimary]);
    }

    for (const c of e.credits) {
      const personId = await resolvePerson(db, filmId, c.tmdbPersonId, c.name);
      await db.query(
        `insert into film_credits (film_id, person_id, role, character, ord, source_id) values ($1, $2, $3, $4, $5, 'tmdb')
         on conflict (film_id, person_id, role) do nothing`,
        [filmId, personId, c.role, c.character, c.ord]);
    }
    return "updated";
  });
}

/**
 * Persona de TMDB: por tmdb_id; si no, la misma persona (nombre normalizado) ya acreditada en esta
 * película por otra fuente y sin tmdb_id, a la que se vincula; si no, una persona nueva.
 * No se vincula por nombre fuera de la película: dos homónimos no se fusionan.
 */
async function resolvePerson(db: Db, filmId: string, tmdbId: number, name: string): Promise<string> {
  const { rows: byId } = await db.query<{ id: string }>("select id from people where tmdb_id = $1", [tmdbId]);
  if (byId[0]) return byId[0].id;
  const key = normalizePersonName(name);
  const { rows: sameFilm } = await db.query<{ id: string }>(
    `select distinct p.id from people p join film_credits c on c.person_id = p.id
     where c.film_id = $1 and p.name_key = $2 and p.tmdb_id is null`, [filmId, key]);
  if (sameFilm.length === 1) {
    await db.query("update people set tmdb_id = $2 where id = $1", [sameFilm[0].id, tmdbId]);
    return sameFilm[0].id;
  }
  const { rows: [created] } = await db.query<{ id: string }>(
    "insert into people (name, name_key, tmdb_id) values ($1, $2, $3) returning id", [name, key, tmdbId]);
  return created.id;
}
