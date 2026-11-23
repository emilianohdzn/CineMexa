// Lectura de /movie/{id}?append_to_response=release_dates,credits,videos (TMDB v3).
// Sólo se toma lo que TMDB permite mostrar con atribución; no se usa su "popularity" como tendencia.
import { normalizeImdbId } from "../../../packages/core/src/index.ts";

export const TMDB_API = "https://api.themoviedb.org/3";
export const TMDB_IMAGES = "https://image.tmdb.org/t/p";
export const TMDB_ATTRIBUTION = "This product uses the TMDB API but is not endorsed or certified by TMDB.";

export interface TmdbMovie {
  id: number;
  title?: string;
  original_title?: string;
  overview?: string;
  runtime?: number | null;
  imdb_id?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  release_dates?: { results: Array<{ iso_3166_1: string; release_dates: Array<{ type: number; release_date: string; note?: string }> }> };
  credits?: {
    cast: Array<{ id: number; name: string; character?: string; order: number }>;
    crew: Array<{ id: number; name: string; job: string; department: string }>;
  };
  videos?: { results: Array<{ site: string; key: string; type: string; official?: boolean; iso_639_1?: string; published_at?: string }> };
}

export interface TmdbEnrichment {
  tmdbId: number;
  imdbId: string | null;
  synopsis: string | null;
  runtimeMinutes: number | null;
  /** Estreno en salas en México (tipo 3 teatral o 2 limitado). Nunca se deduce de otro país. */
  mxReleaseDate: string | null;
  poster: { url: string; path: string } | null;
  backdrop: { url: string; path: string } | null;
  trailerUrl: string | null;
  credits: Array<{ tmdbPersonId: number; name: string; role: "cast" | "writer" | "cinematographer" | "producer" | "editor" | "composer" | "director"; character: string | null; ord: number }>;
  sourceUrl: string;
}

const CREW_ROLES: Record<string, TmdbEnrichment["credits"][number]["role"]> = {
  Director: "director", Screenplay: "writer", Writer: "writer", "Director of Photography": "cinematographer",
  Producer: "producer", Editor: "editor", "Original Music Composer": "composer",
};

export const MAX_CAST = 12;

export function parseMovie(m: TmdbMovie): TmdbEnrichment {
  const mx = m.release_dates?.results.find((r) => r.iso_3166_1 === "MX");
  const theatrical = (mx?.release_dates ?? [])
    .filter((d) => d.type === 3 || d.type === 2)
    .map((d) => d.release_date.slice(0, 10))
    .sort();

  const videos = (m.videos?.results ?? []).filter((v) => v.site === "YouTube" && v.type === "Trailer");
  const trailer = videos.find((v) => v.official && v.iso_639_1 === "es") ?? videos.find((v) => v.official) ?? videos[0];

  const credits: TmdbEnrichment["credits"] = [];
  const seen = new Set<string>();
  for (const c of [...(m.credits?.cast ?? [])].sort((a, b) => a.order - b.order).slice(0, MAX_CAST)) {
    credits.push({ tmdbPersonId: c.id, name: c.name, role: "cast", character: c.character?.trim() || null, ord: c.order });
  }
  (m.credits?.crew ?? []).forEach((c, i) => {
    const role = CREW_ROLES[c.job];
    const key = `${c.id}:${role}`;
    if (!role || seen.has(key)) return;
    seen.add(key);
    credits.push({ tmdbPersonId: c.id, name: c.name, role, character: null, ord: i });
  });

  const image = (path: string | null | undefined, size: string) => (path ? { url: `${TMDB_IMAGES}/${size}${path}`, path } : null);
  return {
    tmdbId: m.id,
    imdbId: normalizeImdbId(m.imdb_id),
    synopsis: m.overview?.trim() || null,
    runtimeMinutes: m.runtime && m.runtime > 0 ? m.runtime : null,
    mxReleaseDate: theatrical[0] ?? null,
    poster: image(m.poster_path, "w780"),
    backdrop: image(m.backdrop_path, "w1280"),
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    credits,
    sourceUrl: `https://www.themoviedb.org/movie/${m.id}`,
  };
}

export function movieUrl(id: number): string {
  return `${TMDB_API}/movie/${id}?language=es-MX&append_to_response=release_dates,credits,videos&include_video_language=es,en,null`;
}
