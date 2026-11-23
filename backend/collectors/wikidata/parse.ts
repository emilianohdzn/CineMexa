// Convierte la respuesta SPARQL en candidatos normalizados. No inventa nada:
// los campos ausentes quedan en null y la película sin título se descarta.
import { normalizeCountry, normalizeImdbId, normalizeWikidataId, type FilmCandidate, type FilmKind, type MexicanParticipation } from "../../../packages/core/src/index.ts";
import { FILM_CLASSES } from "./sparql.ts";

export interface SparqlValue { type: string; value: string; "xml:lang"?: string; datatype?: string }
export interface SparqlResponse { results: { bindings: Array<Record<string, SparqlValue | undefined>> } }

export interface WikidataFilm extends FilmCandidate {
  wikidataId: string;
  englishTitle: string | null;
  releaseDate: string | null; // primera fecha de publicación (YYYY-MM-DD), cualquier país
  directorsWithIds: Array<{ wikidataId: string; name: string }>;
  mxParticipation: MexicanParticipation;
  isDocumentary: boolean;
  isAnimation: boolean;
  genreIds: string[];
  genres: string[];
}

/** Umbral de la Academia: 40 minutos o menos es cortometraje. */
export const SHORT_MAX_MINUTES = 40;
const DOCUMENTARY_GENRES = new Set([FILM_CLASSES.documentaryFilm]);
const ANIMATION_GENRES = new Set([FILM_CLASSES.animatedFilm, "Q581714" /* animación */]);

/** Géneros de Wikidata con nombre en español. Los que no están aquí se ignoran (no se adivinan). */
export const GENRE_LABELS: Record<string, string> = {
  Q130232: "Drama", Q157443: "Comedia", Q200092: "Terror", Q93204: "Documental", Q2484376: "Thriller",
  Q471839: "Ciencia ficción", Q202866: "Animación", Q1054574: "Romance", Q319221: "Aventura",
  Q157394: "Fantasía", Q842256: "Musical", Q959790: "Crimen", Q172980: "Western", Q645928: "Biográfico",
  Q17013749: "Histórico", Q188473: "Acción", Q1200678: "Comedia dramática", Q52162262: "Cine experimental",
};

const split = (v: SparqlValue | undefined) => (v?.value ? v.value.split("|").filter(Boolean) : []);

export function parseDiscoverResponse(json: SparqlResponse, retrievedAt: string): WikidataFilm[] {
  const films: WikidataFilm[] = [];
  for (const row of json.results.bindings) {
    const wikidataId = normalizeWikidataId(row.film?.value);
    // Wikidata devuelve el Q-id como etiqueta cuando no hay etiqueta: no es un título.
    const label = [row.filmLabel?.value, row.filmLabelEn?.value].find((t) => t && !/^Q\d+$/.test(t)) ?? null;
    const original = row.original?.value?.trim() || null;
    const title = label ?? original;
    if (!wikidataId || !title) continue;

    const published = row.published?.value ? row.published.value.slice(0, 10) : null;
    const year = published && /^\d{4}/.test(published) ? Number(published.slice(0, 4)) : null;
    const runtimeRaw = row.runtime?.value ? Math.round(Number(row.runtime.value)) : null;
    const runtimeMinutes = runtimeRaw && runtimeRaw > 0 && runtimeRaw < 2000 ? runtimeRaw : null;

    const classes = new Set(split(row.classes));
    const genres = split(row.genres);
    const countries = [...new Set(split(row.countries).map(normalizeCountry).filter((c): c is string => !!c))].sort();

    let kind: FilmKind = "feature";
    if (classes.has(FILM_CLASSES.shortFilm)) kind = "short";
    else if (runtimeMinutes !== null && runtimeMinutes <= SHORT_MAX_MINUTES && !classes.has(FILM_CLASSES.featureFilm)) kind = "short";

    const seen = new Set<string>();
    const directorsWithIds: Array<{ wikidataId: string; name: string }> = [];
    for (const entry of split(row.directors)) {
      const [id, ...nameParts] = entry.split("~");
      const qid = normalizeWikidataId(id);
      const name = nameParts.join("~").trim();
      if (!qid || !name || seen.has(qid)) continue; // la etiqueta en español llega primero cuando existe
      seen.add(qid);
      directorsWithIds.push({ wikidataId: qid, name });
    }

    const tmdb = row.tmdbId?.value && /^\d+$/.test(row.tmdbId.value) ? Number(row.tmdbId.value) : null;
    films.push({
      wikidataId,
      title,
      originalTitle: original && original !== title ? original : null,
      englishTitle: row.filmLabelEn?.value && row.filmLabelEn.value !== title ? row.filmLabelEn.value : null,
      year,
      releaseDate: published && /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : null,
      kind,
      runtimeMinutes,
      countries: countries.length ? countries : ["MX"],
      // Sólo México como país de origen → producción mexicana; con otros países → coproducción.
      // No se infiere si la participación es mayoritaria o minoritaria.
      mxParticipation: countries.length > 1 ? "coproduction" : "unknown",
      directors: directorsWithIds.map((d) => d.name),
      directorsWithIds,
      isDocumentary: classes.has(FILM_CLASSES.documentaryFilm) || genres.some((g) => DOCUMENTARY_GENRES.has(g as never)),
      isAnimation: classes.has(FILM_CLASSES.animatedFilm) || genres.some((g) => ANIMATION_GENRES.has(g as never)),
      genreIds: genres,
      genres: [...new Set(genres.map((g) => GENRE_LABELS[g]).filter((g): g is string => !!g))],
      ids: { wikidata: wikidataId, tmdb, imdb: normalizeImdbId(row.imdbId?.value) },
      provenance: {
        source: "wikidata",
        sourceUrl: `https://www.wikidata.org/wiki/${wikidataId}`,
        retrievedAt,
        verification: "automatic",
      },
    });
  }
  return films;
}
