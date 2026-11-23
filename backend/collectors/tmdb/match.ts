// Busca el id de TMDB de películas que no lo traen de Wikidata. Sólo se vincula automáticamente con evidencia fuerte:
//  1. IMDb id (de Wikidata) → /find de TMDB, con un único resultado y año compatible.
//  2. Título normalizado IDÉNTICO (título u original) + año ±1 + al menos un director en común, y un único candidato así.
// Cualquier otra cosa (varios candidatos, sin director local, id ya asignado a otra película) va a match_reviews
// como 'pending'. Un título parecido nunca basta. Sin candidatos se registra 'no_match' y se reintenta tras `retryDays`.
import { normalizePersonName, normalizeTitle } from "../../../packages/core/src/index.ts";
import { fetchJson, type FetchOptions } from "../lib/http.ts";
import { type Db } from "../lib/db.ts";
import { TMDB_API } from "./parse.ts";

export interface MatchTarget {
  film_id: string;
  title: string;
  original_title: string | null;
  year: number | null;
  imdb_id: string | null;
  directors: string[];
}

interface FindResponse { movie_results: Array<{ id: number; title?: string; original_title?: string; release_date?: string }> }
interface SearchResponse { results: Array<{ id: number; title?: string; original_title?: string; release_date?: string }> }
interface CreditsResponse { crew: Array<{ job: string; name: string }> }

export type MatchOutcome =
  | { kind: "matched"; tmdbId: number; label?: string; method: "imdb_find" | "title_year_director"; evidence: Record<string, unknown> }
  | { kind: "review"; candidates: Array<{ tmdbId: number; label: string; score: number; evidence: Record<string, unknown> }>; method: string }
  | { kind: "no_match"; method: string; evidence: Record<string, unknown> };

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const labelOf = (m: { title?: string; original_title?: string; release_date?: string }) =>
  `${m.title ?? m.original_title ?? "sin título"} (${yearOf(m.release_date) ?? "s/f"})`;
const yearOk = (a: number | null, b: number | null) => a == null || b == null || Math.abs(a - b) <= 1;

export async function findTmdbMatch(t: MatchTarget, get: <T>(url: string) => Promise<T>, maxCandidates = 5): Promise<MatchOutcome> {
  if (t.imdb_id) {
    const found = await get<FindResponse>(`${TMDB_API}/find/${t.imdb_id}?external_source=imdb_id`);
    const ok = found.movie_results.filter((m) => yearOk(t.year, yearOf(m.release_date)));
    if (ok.length === 1) {
      return { kind: "matched", tmdbId: ok[0].id, label: labelOf(ok[0]), method: "imdb_find", evidence: { imdb_id: t.imdb_id, tmdb_year: yearOf(ok[0].release_date) } };
    }
    if (found.movie_results.length > 0) {
      return {
        kind: "review", method: "imdb_find",
        candidates: found.movie_results.slice(0, maxCandidates).map((m) => ({
          tmdbId: m.id, label: labelOf(m), score: 0.5,
          evidence: { imdb_id: t.imdb_id, motivo: "IMDb devuelve un resultado con año incompatible o varios resultados" },
        })),
      };
    }
  }

  const keys = new Set([t.title, t.original_title].filter((x): x is string => !!x).map(normalizeTitle));
  const seen = new Map<number, SearchResponse["results"][number]>();
  for (const q of new Set([t.title, t.original_title].filter((x): x is string => !!x))) {
    const res = await get<SearchResponse>(`${TMDB_API}/search/movie?query=${encodeURIComponent(q)}&include_adult=false&language=es-MX`);
    for (const r of res.results) if (!seen.has(r.id)) seen.set(r.id, r);
  }
  const sameTitle = [...seen.values()].filter((r) =>
    [r.title, r.original_title].some((x) => x && keys.has(normalizeTitle(x))) && yearOk(t.year, yearOf(r.release_date)));
  if (sameTitle.length === 0) {
    return { kind: "no_match", method: "title_year_director", evidence: { buscados: [...keys], resultados: seen.size } };
  }

  const local = new Set(t.directors.map(normalizePersonName).filter(Boolean));
  const scored: Array<{ r: SearchResponse["results"][number]; directors: string[]; shared: boolean }> = [];
  for (const r of sameTitle.slice(0, maxCandidates)) {
    const credits = await get<CreditsResponse>(`${TMDB_API}/movie/${r.id}/credits`);
    const directors = credits.crew.filter((c) => c.job === "Director").map((c) => c.name);
    scored.push({ r, directors, shared: directors.some((d) => local.has(normalizePersonName(d))) });
  }
  const withDirector = scored.filter((s) => s.shared);
  if (local.size > 0 && withDirector.length === 1) {
    const s = withDirector[0];
    return {
      kind: "matched", tmdbId: s.r.id, label: labelOf(s.r), method: "title_year_director",
      evidence: { titulo: s.r.title, anio_tmdb: yearOf(s.r.release_date), anio_local: t.year, directores_tmdb: s.directors },
    };
  }
  return {
    kind: "review", method: "title_year_director",
    candidates: scored.map((s) => ({
      tmdbId: s.r.id, label: labelOf(s.r),
      score: s.shared ? 0.8 : 0.4,
      evidence: {
        directores_tmdb: s.directors, directores_locales: t.directors,
        motivo: local.size === 0 ? "La película no tiene director registrado" : withDirector.length > 1 ? "Varios candidatos con el mismo director" : "Ningún director en común",
      },
    })),
  };
}

export interface MatchRunOptions {
  token: string;
  limit?: number;
  /** Días antes de volver a buscar una película sin coincidencia. */
  retryDays?: number;
  delayMs?: number;
  http?: Omit<FetchOptions, "headers">;
}

/** Películas publicadas sin id de TMDB y sin decisión reciente en la cola. */
export async function pendingMatchTargets(db: Db, limit: number, retryDays: number): Promise<MatchTarget[]> {
  const { rows } = await db.query<MatchTarget>(`
    select f.id::text as film_id, f.title, f.original_title, f.year,
           (select external_id from film_external_ids i where i.film_id = f.id and i.provider = 'imdb') as imdb_id,
           coalesce((select array_agg(p.name order by c.ord) from film_credits c join people p on p.id = c.person_id
                     where c.film_id = f.id and c.role = 'director'), '{}') as directors
    from films f
    where f.published and f.merged_into is null
      and not exists (select 1 from film_external_ids t where t.film_id = f.id and t.provider = 'tmdb')
      and not exists (select 1 from match_reviews m where m.entity_type = 'film' and m.entity_id = f.id and m.provider = 'tmdb'
                      and (m.status in ('pending', 'rejected', 'accepted') or m.updated_at > now() - make_interval(days => $2)))
    order by f.year desc nulls last, f.title
    limit $1`, [limit, retryDays]);
  return rows;
}

async function upsertReview(db: Db, filmId: string, candidateId: string | null, label: string | null, method: string,
  status: string, score: number | null, evidence: Record<string, unknown>) {
  await db.query(`
    insert into match_reviews (entity_type, entity_id, provider, candidate_id, candidate_label, method, status, score, evidence)
    values ('film', $1, 'tmdb', $2, $3, $4, $5, $6, $7)
    on conflict (entity_type, entity_id, provider, candidate_id) do update
      set method = excluded.method, score = excluded.score, evidence = excluded.evidence, updated_at = now(),
          candidate_label = coalesce(excluded.candidate_label, match_reviews.candidate_label),
          status = case when match_reviews.status in ('accepted', 'rejected') then match_reviews.status else excluded.status end`,
    [filmId, candidateId, label, method, status, score, JSON.stringify(evidence)]);
}

/** Aplica un resultado. Si el id de TMDB ya pertenece a otra película (posible duplicado), va a revisión. */
export async function applyMatch(db: Db, t: MatchTarget, outcome: MatchOutcome): Promise<"matched" | "review" | "no_match"> {
  if (outcome.kind === "matched") {
    const { rows: owner } = await db.query<{ film_id: string }>(
      "select film_id::text from film_external_ids where provider = 'tmdb' and external_id = $1", [String(outcome.tmdbId)]);
    if (owner.length > 0 && owner[0].film_id !== t.film_id) {
      await upsertReview(db, t.film_id, String(outcome.tmdbId), outcome.label ?? null, outcome.method, "pending", 0.9,
        { ...outcome.evidence, motivo: "El id de TMDB ya pertenece a otra película: posible duplicado", otra_pelicula: owner[0].film_id });
      return "review";
    }
    await db.query(
      `insert into film_external_ids (film_id, provider, external_id, source_id) values ($1, 'tmdb', $2, 'tmdb')
       on conflict do nothing`, [t.film_id, String(outcome.tmdbId)]);
    await upsertReview(db, t.film_id, String(outcome.tmdbId), outcome.label ?? null, outcome.method, "auto_matched", 1, outcome.evidence);
    return "matched";
  }
  if (outcome.kind === "review") {
    for (const c of outcome.candidates) await upsertReview(db, t.film_id, String(c.tmdbId), c.label, outcome.method, "pending", c.score, c.evidence);
    return "review";
  }
  await upsertReview(db, t.film_id, null, null, outcome.method, "no_match", null, outcome.evidence);
  return "no_match";
}

export async function runTmdbMatch(db: Db, opts: MatchRunOptions) {
  const { limit = 100, retryDays = 14, delayMs = 60, http = {} } = opts;
  const get = async <T,>(url: string) => {
    const r = await fetchJson<T>(url, { ...http, headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" } });
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    return r;
  };
  const targets = await pendingMatchTargets(db, limit, retryDays);
  const counts = { matched: 0, review: 0, no_match: 0 };
  const errors: string[] = [];
  for (const t of targets) {
    try {
      counts[await applyMatch(db, t, await findTmdbMatch(t, get))]++;
    } catch (error) {
      errors.push(`film:${t.film_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { seen: targets.length, counts, errors };
}
