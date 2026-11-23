// Escribe candidatos de Wikidata en Postgres respetando la curaduría:
// - Se resuelve la película por id externo (Wikidata, luego IMDb/TMDB). Nunca por título a ciegas.
// - Si sólo coincide título normalizado + año con otra película sin Q-id, se crea aparte con
//   needs_review = true para que el equipo editorial decida (no se fusiona automáticamente).
// - Los campos de películas 'verified' o 'editorial' no se sobrescriben.
// - Un registro sin cambios (mismo hash) no toca las tablas de hechos.
import { normalizePersonName, normalizeTitle } from "../../../packages/core/src/index.ts";
import { inTransaction, type Db } from "../lib/db.ts";
import { linkSourceRecord, recordSource } from "../lib/runs.ts";
import { slugify } from "../lib/slug.ts";
import type { WikidataFilm } from "./parse.ts";

const SOURCE = "wikidata";

export type UpsertOutcome = "created" | "updated" | "unchanged" | "flagged";

export interface UpsertResult {
  outcome: UpsertOutcome;
  filmId: string;
  conflicts: string[];
}

export async function upsertWikidataFilm(db: Db, film: WikidataFilm, runId: string): Promise<UpsertResult> {
  return inTransaction(db, async () => {
    const { changed } = await recordSource(db, {
      sourceId: SOURCE, entityType: "film", externalId: film.wikidataId,
      sourceUrl: film.provenance.sourceUrl, payload: payloadOf(film), runId,
    });

    const existing = await findFilm(db, film);
    if (existing && !changed) {
      await linkSourceRecord(db, SOURCE, "film", film.wikidataId, existing.id);
      return { outcome: "unchanged", filmId: existing.id, conflicts: [] };
    }

    let filmId: string;
    let outcome: UpsertOutcome;
    const conflicts: string[] = [];
    if (existing) {
      filmId = existing.id;
      outcome = "updated";
      if (existing.verification === "automatic" || existing.verification === "unverified") {
        await db.query(
          `update films set title = $2, original_title = $3, year = $4, kind = $5, runtime_minutes = $6, countries = $7,
             mx_participation = $8, is_documentary = $9, is_animation = $10, genres = $11, updated_at = now()
           where id = $1`,
          [filmId, film.title, film.originalTitle, film.year, film.kind, film.runtimeMinutes, film.countries,
           film.mxParticipation, film.isDocumentary, film.isAnimation, film.genres],
        );
      } else {
        // Curado a mano: sólo se completan huecos.
        await db.query(
          `update films set year = coalesce(year, $2), runtime_minutes = coalesce(runtime_minutes, $3),
             original_title = coalesce(original_title, $4), updated_at = now() where id = $1`,
          [filmId, film.year, film.runtimeMinutes, film.originalTitle],
        );
      }
    } else {
      const lookalike = await findLookalike(db, film);
      const needsReview = lookalike !== null;
      if (lookalike) conflicts.push(`posible duplicado de ${lookalike}`);
      const { rows } = await db.query<{ id: string }>(
        `insert into films (slug, title, original_title, year, kind, runtime_minutes, countries, mx_participation,
           is_documentary, is_animation, genres, verification, needs_review, published)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'automatic', $12, $13) returning id`,
        [await uniqueSlug(db, film), film.title, film.originalTitle, film.year, film.kind, film.runtimeMinutes,
         film.countries, film.mxParticipation, film.isDocumentary, film.isAnimation, film.genres,
         needsReview, !needsReview],
      );
      filmId = rows[0].id;
      outcome = needsReview ? "flagged" : "created";
    }

    await upsertTitles(db, filmId, film);
    conflicts.push(...(await upsertExternalIds(db, filmId, film)));
    await upsertDirectors(db, filmId, film);
    if (conflicts.length && outcome !== "flagged") {
      await db.query("update films set needs_review = true where id = $1", [filmId]);
      outcome = "flagged";
    }
    await linkSourceRecord(db, SOURCE, "film", film.wikidataId, filmId);
    return { outcome, filmId, conflicts };
  });
}

function payloadOf(film: WikidataFilm) {
  // Sin retrievedAt: si sólo cambia la hora de consulta, el hash no cambia.
  const { provenance, ...rest } = film;
  return { ...rest, sourceUrl: provenance.sourceUrl };
}

async function findFilm(db: Db, film: WikidataFilm): Promise<{ id: string; verification: string } | null> {
  const pairs: Array<[string, string]> = [["wikidata", film.wikidataId]];
  if (film.ids.imdb) pairs.push(["imdb", film.ids.imdb]);
  if (film.ids.tmdb) pairs.push(["tmdb", String(film.ids.tmdb)]);
  for (const [provider, externalId] of pairs) {
    const { rows } = await db.query<{ id: string; verification: string }>(
      `select f.id, f.verification::text as verification from film_external_ids e join films f on f.id = e.film_id
       where e.provider = $1 and e.external_id = $2 and f.merged_into is null`,
      [provider, externalId],
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

async function findLookalike(db: Db, film: WikidataFilm): Promise<string | null> {
  if (film.year === null) return null;
  const { rows } = await db.query<{ id: string; slug: string; title: string }>(
    `select f.id, f.slug, f.title from films f
     where f.year between $1 - 1 and $1 + 1 and f.merged_into is null
       and not exists (select 1 from film_external_ids e where e.film_id = f.id and e.provider = 'wikidata')`,
    [film.year],
  );
  const key = normalizeTitle(film.title);
  return rows.find((r) => normalizeTitle(r.title) === key)?.slug ?? null;
}

async function uniqueSlug(db: Db, film: WikidataFilm): Promise<string> {
  for (const candidate of [slugify(film.title, film.year), slugify(film.title, film.year, film.wikidataId)]) {
    const { rows } = await db.query("select 1 from films where slug = $1", [candidate]);
    if (rows.length === 0) return candidate;
  }
  return slugify(film.wikidataId);
}

async function upsertTitles(db: Db, filmId: string, film: WikidataFilm) {
  const titles: Array<[string, string | null]> = [[film.title, "es"]];
  if (film.originalTitle) titles.push([film.originalTitle, null]);
  if (film.englishTitle) titles.push([film.englishTitle, "en"]);
  for (const [title, language] of titles) {
    await db.query(
      "insert into film_titles (film_id, title, language, source_id) values ($1, $2, $3, $4) on conflict do nothing",
      [filmId, title, language, SOURCE],
    );
  }
}

/** Devuelve conflictos: un id externo que ya pertenece a otra película. */
async function upsertExternalIds(db: Db, filmId: string, film: WikidataFilm): Promise<string[]> {
  const conflicts: string[] = [];
  const ids: Array<[string, string, boolean]> = [["wikidata", film.wikidataId, true]];
  if (film.ids.imdb) ids.push(["imdb", film.ids.imdb, false]);
  if (film.ids.tmdb) ids.push(["tmdb", String(film.ids.tmdb), false]);
  for (const [provider, externalId, canonical] of ids) {
    const { rows } = await db.query<{ film_id: string; external_id: string }>(
      "select film_id, external_id from film_external_ids where (provider = $1 and external_id = $2) or (film_id = $3 and provider = $1)",
      [provider, externalId, filmId],
    );
    const owner = rows.find((r) => r.external_id === externalId);
    if (owner && owner.film_id !== filmId) { conflicts.push(`${provider}:${externalId} ya asignado a otra película`); continue; }
    const mine = rows.find((r) => r.film_id === filmId);
    if (mine && mine.external_id !== externalId) { conflicts.push(`${provider} distinto: ${mine.external_id} vs ${externalId}`); continue; }
    if (!mine) {
      const hasCanonical = canonical
        ? (await db.query("select 1 from film_external_ids where film_id = $1 and is_canonical", [filmId])).rows.length > 0
        : true;
      await db.query(
        "insert into film_external_ids (film_id, provider, external_id, is_canonical, source_id) values ($1, $2, $3, $4, $5)",
        [filmId, provider, externalId, canonical && !hasCanonical, SOURCE],
      );
    }
  }
  return conflicts;
}

async function upsertDirectors(db: Db, filmId: string, film: WikidataFilm) {
  let ord = 0;
  for (const d of film.directorsWithIds) {
    const { rows } = await db.query<{ id: string }>(
      `insert into people (name, name_key, wikidata_id) values ($1, $2, $3)
       on conflict (wikidata_id) do update set name = excluded.name, name_key = excluded.name_key
       returning id`,
      [d.name, normalizePersonName(d.name), d.wikidataId],
    );
    await db.query(
      `insert into film_credits (film_id, person_id, role, ord, source_id) values ($1, $2, 'director', $3, $4)
       on conflict (film_id, person_id, role) do update set ord = excluded.ord`,
      [filmId, rows[0].id, ord++, SOURCE],
    );
  }
}
