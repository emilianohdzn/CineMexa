// Consulta SPARQL de descubrimiento: obras con México (Q96) como país de origen (P495).
// Una fila por película gracias a GROUP_CONCAT; paginada por Q-id para que sea estable.

export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

/** Clases de Wikidata que cuentan como película. */
export const FILM_CLASSES = {
  film: "Q11424",
  shortFilm: "Q24862",
  featureFilm: "Q24869",
  documentaryFilm: "Q93204",
  animatedFilm: "Q202866",
} as const;

export interface DiscoverQuery {
  fromYear: number;
  limit: number;
  offset: number;
}

export function buildDiscoverQuery({ fromYear, limit, offset }: DiscoverQuery): string {
  if (!Number.isInteger(fromYear) || !Number.isInteger(limit) || !Number.isInteger(offset)) {
    throw new TypeError("fromYear, limit y offset deben ser enteros");
  }
  const classes = Object.values(FILM_CLASSES).map((q) => `wd:${q}`).join(" ");
  return `
SELECT ?film ?filmLabel ?filmLabelEn
  (SAMPLE(?originalTitle) AS ?original)
  (MIN(?date) AS ?published)
  (MAX(?duration) AS ?runtime)
  (SAMPLE(?imdb) AS ?imdbId)
  (SAMPLE(?tmdb) AS ?tmdbId)
  (GROUP_CONCAT(DISTINCT ?countryCode; separator="|") AS ?countries)
  (GROUP_CONCAT(DISTINCT CONCAT(STRAFTER(STR(?director), "entity/"), "~", ?directorLabel); separator="|") AS ?directors)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?class), "entity/"); separator="|") AS ?classes)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?genre), "entity/"); separator="|") AS ?genres)
WHERE {
  ?film wdt:P495 wd:Q96 ;
        wdt:P31 ?class ;
        wdt:P577 ?date .
  VALUES ?class { ${classes} }
  FILTER(YEAR(?date) >= ${fromYear})
  OPTIONAL { ?film wdt:P1476 ?originalTitle . }
  OPTIONAL { ?film wdt:P2047 ?duration . }
  OPTIONAL { ?film wdt:P345 ?imdb . }
  OPTIONAL { ?film wdt:P4947 ?tmdb . }
  OPTIONAL { ?film wdt:P495 ?country . ?country wdt:P297 ?countryCode . }
  OPTIONAL { ?film wdt:P136 ?genre . }
  OPTIONAL {
    ?film wdt:P57 ?director .
    ?director rdfs:label ?directorLabel .
    FILTER(LANG(?directorLabel) IN ("es", "en", "mul"))
  }
  OPTIONAL { ?film rdfs:label ?filmLabel . FILTER(LANG(?filmLabel) = "es") }
  OPTIONAL { ?film rdfs:label ?filmLabelEn . FILTER(LANG(?filmLabelEn) = "en") }
}
GROUP BY ?film ?filmLabel ?filmLabelEn
ORDER BY ?film
LIMIT ${limit}
OFFSET ${offset}`.trim();
}

export function discoverUrl(q: DiscoverQuery): string {
  return `${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(buildDiscoverQuery(q))}`;
}
