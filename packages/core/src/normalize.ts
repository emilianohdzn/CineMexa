// Normalización de títulos, nombres y países para comparar registros de distintas fuentes.

const LEADING_ARTICLES = [
  "el", "la", "los", "las", "lo", "un", "una", "unos", "unas",
  "the", "a", "an", "le", "les", "l", "il", "lo",
];

/** Quita acentos y diacríticos conservando la ñ como n (comparación, no visualización). */
export function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Clave de comparación de un título: minúsculas, sin diacríticos, sin signos,
 * sin artículo inicial y con espacios colapsados.
 */
export function normalizeTitle(title: string): string {
  let t = stripDiacritics(title.toLowerCase())
    .replace(/&/g, " y ")
    .replace(/['’`´]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = t.split(" ");
  if (words.length > 1 && LEADING_ARTICLES.includes(words[0])) {
    t = words.slice(1).join(" ");
  }
  return t;
}

/** Nombre de persona normalizado: sin diacríticos, sin puntos ni iniciales sueltas. */
export function normalizePersonName(name: string): string {
  return stripDiacritics(name.toLowerCase())
    .replace(/[.\-]/g, " ")
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .join(" ");
}

const COUNTRY_ALIASES: Record<string, string> = {
  mexico: "MX", "estados unidos mexicanos": "MX", mx: "MX", mex: "MX", q96: "MX",
  "estados unidos": "US", "united states": "US", usa: "US", us: "US", q30: "US",
  espana: "ES", spain: "ES", es: "ES", q29: "ES",
  francia: "FR", france: "FR", fr: "FR", q142: "FR",
  argentina: "AR", ar: "AR", q414: "AR",
  colombia: "CO", co: "CO", q739: "CO",
  alemania: "DE", germany: "DE", de: "DE", q183: "DE",
  canada: "CA", ca: "CA", q16: "CA",
  chile: "CL", cl: "CL", q298: "CL",
};

/** Convierte nombre, ISO o Q-id de Wikidata a ISO alpha-2. Devuelve null si no lo reconoce. */
export function normalizeCountry(value: string): string | null {
  const key = stripDiacritics(value.trim().toLowerCase());
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return null;
}

/** Una película es mexicana para Cine Mexa si México figura entre los países productores. */
export function isMexicanProduction(countries: string[] | undefined): boolean {
  return (countries ?? []).some((c) => normalizeCountry(c) === "MX");
}

/** Valida y normaliza un Q-id de Wikidata ("Q123", "wd:Q123" o URL de entidad). */
export function normalizeWikidataId(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/Q[1-9]\d*$/i);
  return m ? m[0].toUpperCase() : null;
}

export function normalizeImdbId(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/tt\d{7,9}/i);
  return m ? m[0].toLowerCase() : null;
}
