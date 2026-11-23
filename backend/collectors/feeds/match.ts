// Vinculación de un artículo con una película del catálogo. Un título parecido NUNCA basta:
// se vincula solo si hay un único candidato, el año es compatible y existe evidencia adicional
// (el título va entre comillas en el titular, la etiqueta del artículo es el título, o se menciona a quien dirige).
// Cualquier otra coincidencia va a la cola de revisión.
import { normalizePersonName, normalizeTitle, stripDiacritics } from "../../../packages/core/src/index.ts";
import type { FeedItem } from "./parse.ts";

export interface FilmKey { id: string; title: string; year: number | null; keys: string[]; directors: string[] }

export type ArticleMatch =
  | { kind: "linked"; film: FilmKey; evidence: string[] }
  | { kind: "ambiguous"; candidates: Array<{ film: FilmKey; evidence: string[]; motivo: string }> }
  | { kind: "none" };

/** Texto comparable SIN quitar artículos (para buscar una frase dentro de un titular). */
export const textKey = (s: string) => stripDiacritics(s.toLowerCase()).replace(/&/g, " y ").replace(/['’`´]/g, " ")
  .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const QUOTED = /[«“"‘']([^«»“”"‘’']{2,140})[»”"’']/g;

export function filmKey(f: { id: string; title: string; original_title?: string | null; year: number | null; directors?: string[] }): FilmKey {
  const keys = [...new Set([f.title, f.original_title].filter((x): x is string => !!x).map(normalizeTitle))].filter((k) => k.length >= 3);
  return { id: f.id, title: f.title, year: f.year, keys, directors: (f.directors ?? []).map(normalizePersonName).filter((d) => d.includes(" ")) };
}

export function matchArticle(item: FeedItem, films: FilmKey[]): ArticleMatch {
  const headline = ` ${textKey(item.title)} `;
  const quoted = new Set([...item.title.matchAll(QUOTED)].map((m) => normalizeTitle(m[1])));
  const tags = new Set(item.categories.map(normalizeTitle));
  const people = ` ${normalizePersonName([item.title, ...item.categories].join(" "))} `;
  const pubYear = Number(item.publishedAt.slice(0, 4));

  const hits: Array<{ film: FilmKey; evidence: string[]; yearOk: boolean }> = [];
  for (const film of films) {
    const key = film.keys.find((k) => headline.includes(` ${k} `) || tags.has(k));
    if (!key) continue;
    const evidence: string[] = [];
    if (quoted.has(key)) evidence.push("título entre comillas en el titular");
    if (tags.has(key)) evidence.push("etiqueta del artículo");
    const director = film.directors.find((d) => people.includes(` ${d} `));
    if (director) evidence.push(`menciona a quien dirige (${director})`);
    const yearOk = film.year == null || (film.year >= pubYear - 3 && film.year <= pubYear + 1);
    hits.push({ film, evidence, yearOk });
  }
  // Un título contenido en otro ("Familia" dentro de "Familia de medianoche") cuenta sólo el más largo.
  const longest = hits.filter((h) => !hits.some((o) => o !== h && o.film.keys.some((k) => h.film.keys.some((hk) => k !== hk && ` ${k} `.includes(` ${hk} `)))));
  if (longest.length === 0) return { kind: "none" };
  if (longest.length === 1 && longest[0].yearOk && longest[0].evidence.length > 0) {
    return { kind: "linked", film: longest[0].film, evidence: longest[0].evidence };
  }
  return {
    kind: "ambiguous",
    candidates: longest.slice(0, 5).map((h) => ({
      film: h.film, evidence: h.evidence,
      motivo: longest.length > 1 ? "Varias películas coinciden con el titular"
        : !h.yearOk ? "El año de la película no es compatible con la fecha del artículo"
        : "Sólo coincide el título: sin comillas, etiqueta ni mención de quien dirige",
    })),
  };
}

export type ArticleKind = "review" | "news";
export function classifyArticle(item: FeedItem, feedKind: "reviews" | "news" | "mixed"): ArticleKind {
  if (feedKind === "reviews") return "review";
  if (feedKind === "news") return "news";
  const t = ` ${textKey([item.title, ...item.categories].join(" "))} `;
  return /\s(critica|resena|review|reseña)\s/.test(t) ? "review" : "news";
}

export function newsKind(title: string): "award" | "selection" | "premiere" | "call" | "publication" {
  const t = ` ${textKey(title)} `;
  if (/\s(gana|ganan|ganadora?s?|premio|premios|premiada|galardon\w*|palma de oro|oso de|leon de|ariel|goya|oscar)\s/.test(t)) return "award";
  if (/\s(convocatoria)\s/.test(t)) return "call";
  if (/\s(seleccion\w*|competencia|seleccionada|programacion|inaugura\w*|clausura\w*)\s/.test(t)) return "selection";
  if (/\s(estreno|estrena|estrenara|llega a cines|premiere)\s/.test(t)) return "premiere";
  return "publication";
}
