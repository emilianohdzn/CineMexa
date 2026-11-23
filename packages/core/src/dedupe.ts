// Deduplicación y fusión de candidatos de película provenientes de varias fuentes.
// Regla de identidad: Wikidata es la fuente canónica; TMDB e IMDb son identificadores
// complementarios. Sin identificadores compartidos se usa título normalizado + año ± 1
// + coincidencia de dirección, y el resultado queda como "probable" para revisión editorial.

import type { FilmCandidate, VerificationStatus } from "./types.ts";
import {
  isMexicanProduction,
  normalizeCountry,
  normalizeImdbId,
  normalizePersonName,
  normalizeTitle,
  normalizeWikidataId,
} from "./normalize.ts";

export type MatchStrength = "exact" | "probable" | "none";

export interface MatchResult {
  strength: MatchStrength;
  reason: string;
  score: number; // 0..1
}

function sharedDirector(a: FilmCandidate, b: FilmCandidate): boolean | null {
  const da = (a.directors ?? []).map(normalizePersonName).filter(Boolean);
  const db = (b.directors ?? []).map(normalizePersonName).filter(Boolean);
  if (da.length === 0 || db.length === 0) return null; // sin información
  return da.some((x) => db.includes(x));
}

/** Compara dos candidatos y explica por qué se consideran (o no) la misma obra. */
export function matchFilms(a: FilmCandidate, b: FilmCandidate): MatchResult {
  const qa = normalizeWikidataId(a.ids.wikidata);
  const qb = normalizeWikidataId(b.ids.wikidata);
  if (qa && qb) {
    return qa === qb
      ? { strength: "exact", reason: `wikidata:${qa}`, score: 1 }
      : { strength: "none", reason: "wikidata distinto", score: 0 };
  }
  if (a.ids.tmdb && b.ids.tmdb) {
    return a.ids.tmdb === b.ids.tmdb
      ? { strength: "exact", reason: `tmdb:${a.ids.tmdb}`, score: 1 }
      : { strength: "none", reason: "tmdb distinto", score: 0 };
  }
  const ia = normalizeImdbId(a.ids.imdb);
  const ib = normalizeImdbId(b.ids.imdb);
  if (ia && ib) {
    return ia === ib
      ? { strength: "exact", reason: `imdb:${ia}`, score: 1 }
      : { strength: "none", reason: "imdb distinto", score: 0 };
  }

  const titlesA = [a.title, a.originalTitle].filter(Boolean).map((t) => normalizeTitle(t!));
  const titlesB = [b.title, b.originalTitle].filter(Boolean).map((t) => normalizeTitle(t!));
  const titleMatch = titlesA.some((t) => titlesB.includes(t));
  if (!titleMatch) return { strength: "none", reason: "título distinto", score: 0 };

  if (a.year && b.year && Math.abs(a.year - b.year) > 1) {
    return { strength: "none", reason: "año incompatible", score: 0.1 };
  }
  if (a.kind && b.kind && a.kind !== b.kind) {
    return { strength: "none", reason: "corto vs. largometraje", score: 0.1 };
  }
  const dir = sharedDirector(a, b);
  if (dir === false) return { strength: "none", reason: "dirección distinta", score: 0.2 };
  if (dir === true && a.year && b.year) {
    return { strength: "probable", reason: "título + año + dirección", score: 0.9 };
  }
  return { strength: "probable", reason: "título + año (sin dirección)", score: 0.6 };
}

const VERIFICATION_RANK: Record<VerificationStatus, number> = {
  verified: 4, editorial: 3, automatic: 2, unverified: 1, demo: 0,
};
const SOURCE_PRIORITY: Record<string, number> = { editorial: 3, wikidata: 2, tmdb: 1 };

function precedence(c: FilmCandidate): number {
  return VERIFICATION_RANK[c.provenance.verification] * 10 + (SOURCE_PRIORITY[c.provenance.source] ?? 0);
}

export interface FieldConflict {
  field: string;
  values: { value: unknown; source: string }[];
}

export interface MergedFilm {
  title: string;
  originalTitle: string | null;
  year: number | null;
  kind: FilmCandidate["kind"] | null;
  runtimeMinutes: number | null;
  countries: string[];
  directors: string[];
  ids: { wikidata: string | null; tmdb: number | null; imdb: string | null };
  isMexican: boolean;
  sources: string[];
  conflicts: FieldConflict[];
  needsReview: boolean;
}

/**
 * Fusiona candidatos que ya se determinaron como la misma obra.
 * Cada campo se toma de la fuente con mayor precedencia que lo tenga;
 * los desacuerdos se registran como conflictos para revisión editorial.
 */
export function mergeCandidates(group: FilmCandidate[]): MergedFilm {
  if (group.length === 0) throw new Error("mergeCandidates: grupo vacío");
  const ordered = [...group].sort((x, y) => precedence(y) - precedence(x));
  const conflicts: FieldConflict[] = [];

  function pick<T>(field: string, get: (c: FilmCandidate) => T | null | undefined, eq = (p: T, q: T) => p === q): T | null {
    const present = ordered
      .map((c) => ({ value: get(c), source: c.provenance.source }))
      .filter((v): v is { value: T; source: string } => v.value !== null && v.value !== undefined);
    if (present.length === 0) return null;
    const first = present[0].value;
    if (present.some((v) => !eq(v.value, first))) conflicts.push({ field, values: present });
    return first;
  }

  const countries = [...new Set(ordered.flatMap((c) => (c.countries ?? []).map((x) => normalizeCountry(x) ?? x)))];
  const directorsByKey = new Map<string, string>();
  for (const c of ordered) for (const d of c.directors ?? []) {
    const k = normalizePersonName(d);
    if (!directorsByKey.has(k)) directorsByKey.set(k, d);
  }

  const merged: MergedFilm = {
    title: pick("title", (c) => c.title, (p, q) => normalizeTitle(p) === normalizeTitle(q))!,
    originalTitle: pick("originalTitle", (c) => c.originalTitle),
    year: pick("year", (c) => c.year),
    kind: pick("kind", (c) => c.kind),
    runtimeMinutes: pick("runtimeMinutes", (c) => c.runtimeMinutes, (p, q) => Math.abs(p - q) <= 3),
    countries,
    directors: [...directorsByKey.values()],
    ids: {
      wikidata: pick("ids.wikidata", (c) => normalizeWikidataId(c.ids.wikidata)),
      tmdb: pick("ids.tmdb", (c) => c.ids.tmdb ?? null),
      imdb: pick("ids.imdb", (c) => normalizeImdbId(c.ids.imdb)),
    },
    isMexican: isMexicanProduction(countries),
    sources: [...new Set(ordered.map((c) => c.provenance.source))],
    conflicts,
    needsReview: false,
  };
  merged.needsReview = conflicts.length > 0;
  return merged;
}

/**
 * Agrupa una lista de candidatos en obras. Las coincidencias exactas se fusionan;
 * las probables también, pero marcan la obra como pendiente de revisión.
 */
export function dedupeFilms(candidates: FilmCandidate[]): MergedFilm[] {
  const groups: { members: FilmCandidate[]; probable: boolean }[] = [];
  for (const c of candidates) {
    let best: { idx: number; m: MatchResult } | null = null;
    groups.forEach((g, idx) => {
      // Un candidato debe ser compatible con todos los miembros del grupo.
      const results = g.members.map((m) => matchFilms(c, m));
      if (results.some((r) => r.strength === "none")) return;
      const m = results.reduce((acc, r) => (r.score > acc.score ? r : acc));
      if (!best || m.score > best.m.score) best = { idx, m };
    });
    if (best) {
      const { idx, m } = best as { idx: number; m: MatchResult };
      groups[idx].members.push(c);
      if (m.strength === "probable") groups[idx].probable = true;
    } else {
      groups.push({ members: [c], probable: false });
    }
  }
  return groups.map((g) => {
    const merged = mergeCandidates(g.members);
    if (g.probable) merged.needsReview = true;
    return merged;
  });
}
