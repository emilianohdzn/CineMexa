// Mexa, Fase A: responde preguntas sobre el catálogo SIN modelo de lenguaje. Reglas cerradas sobre los mismos datos
// publicables que el catálogo (leídos como `anon`, con RLS). Cada respuesta cita los registros que la sostienen; si no
// hay datos, lo dice. Nunca predice funciones, fechas ni premios.
import { DEFAULT_SOURCES, normalizePersonName, normalizeTitle } from "../../packages/core/src/index.ts";
import { textKey } from "../collectors/feeds/match.ts";
import type { CatalogRows } from "../catalog/queries.ts";

type Row = Record<string, any>;

export interface MexaCitation {
  type: "film" | "festival_edition" | "festival_event" | "review" | "trend_snapshot";
  id: string;
  label: string;
  source: string;
  url: string | null;
  retrieved_at: string | null;
  verification: string;
}

export interface MexaAnswer {
  intent: "trends" | "festival_dates" | "festival_awards" | "film_awards" | "director_films" | "film_director" | "year_films" | "upcoming" | "film_info" | "clarify" | "unknown";
  text: string;
  items: Array<{ label: string; film_id?: string; festival_id?: string }>;
  citations: MexaCitation[];
  /** Cuando hay varios candidatos: la app ofrece elegir en vez de adivinar. */
  options?: Array<{ label: string; film_id: string }>;
  /** Motivo por el que no se respondió (sin datos, pregunta fuera de alcance). */
  unanswered: string | null;
}

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const has = (q: string, re: RegExp) => re.test(q);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2027-02-10" → "10 de febrero de 2027". */
export const fecha = (d: string) => { const [y, m, day] = d.split("-").map(Number); return `${day} de ${MESES[m - 1]} de ${y}`; };
/** Rango legible: "del 10 al 21 de febrero de 2027", "del 28 de septiembre al 4 de octubre de 2026". */
export function rango(a: string, b: string | null): string {
  if (!b || b === a) return `el ${fecha(a)}`;
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  const da = Number(a.slice(8)), db = Number(b.slice(8));
  if (ya === yb && ma === mb) return `del ${da} al ${db} de ${MESES[mb - 1]} de ${yb}`;
  if (ya === yb) return `del ${da} de ${MESES[ma - 1]} al ${db} de ${MESES[mb - 1]} de ${yb}`;
  return `del ${fecha(a)} al ${fecha(b)}`;
}
const SUGERENCIAS = "Puedo responder, por ejemplo: «¿Quién dirigió …?», «Películas de 2025», «Próximos estrenos», «¿Cuándo es el FICM?», «Premios en Berlinale» o «¿Qué está en tendencia?».";

export function answerQuestion(question: string, rows: CatalogRows, now: Date): MexaAnswer {
  const q = ` ${textKey(question)} `;
  const today = now.toISOString().slice(0, 10);
  const films = new Map(rows.films.map((f) => [String(f.id), f]));
  const directors = new Map<string, string[]>();
  for (const c of rows.credits) if (c.role === "director") (directors.get(c.film_id) ?? directors.set(c.film_id, []).get(c.film_id)!).push(c.name);
  const filmLabel = (f: Row) => `${f.title}${f.year ? ` (${f.year})` : ""}`;
  const filmCite = (f: Row): MexaCitation => ({ type: "film", id: String(f.id), label: filmLabel(f), source: "cinemexa", url: null, retrieved_at: iso(f.updated_at), verification: f.verification });

  // ── Entidades mencionadas ──
  const filmHits = rows.films.flatMap((f) => {
    const keys = [f.title, f.original_title].filter(Boolean).map((t: string) => normalizeTitle(t)).filter((k: string) => k.length >= 4);
    const key = keys.find((k: string) => q.includes(` ${k} `));
    return key ? [{ f, key }] : [];
  });
  const longestKey = Math.max(0, ...filmHits.map((h) => h.key.length));
  const filmMatches = filmHits.filter((h) => h.key.length === longestKey).map((h) => h.f);
  const festKeys = (f: Row) => [f.slug.replace(/-/g, " "), f.short_name, f.name].filter(Boolean).map((s: string) => textKey(s)).filter((k: string) => k.length >= 4);
  const fest = rows.festivals.find((f) => festKeys(f).some((k) => q.includes(` ${k} `)));
  const peopleQ = ` ${normalizePersonName(question)} `;
  const directorNames = [...new Set([...directors.values()].flat())];
  const person = directorNames.map((n) => ({ n, key: normalizePersonName(n) }))
    .filter((p) => p.key.split(" ").length >= 2 && peopleQ.includes(` ${p.key} `))
    .sort((a, b) => b.key.length - a.key.length)[0];

  const clarify = (): MexaAnswer => ({
    intent: "clarify", text: `Hay ${filmMatches.length} películas con ese título. ¿Cuál?`, items: [], citations: [],
    options: filmMatches.map((f) => ({ label: `${filmLabel(f)}${directors.get(f.id)?.length ? ` · ${directors.get(f.id)![0]}` : ""}`, film_id: String(f.id) })),
    unanswered: null,
  });
  const film = filmMatches.length === 1 ? filmMatches[0] : null;

  // ── Tendencias ──
  if (has(q, /\s(tendencia|tendencias|trending|mas visto|mas vistas|populares?)\s/)) {
    const snap = rows.trends.find((t) => t.window_key === "7d") ?? rows.trends[0];
    if (!snap) {
      return { intent: "trends", text: "Todavía no se ha calculado ningún ranking de tendencias.", items: [], citations: [], unanswered: "sin_evidencia" };
    }
    if (!Array.isArray(snap.entries) || snap.entries.length === 0) {
      const min = DEFAULT_SOURCES.youtube.minEvidence;
      return {
        intent: "trends",
        text: `Por ahora no hay ranking: ningún tráiler alcanza la evidencia mínima de la metodología (${min.toLocaleString("es-MX")} vistas nuevas de YouTube en la ventana). No se rellena con puntuaciones simuladas.`,
        items: [],
        citations: [{ type: "trend_snapshot", id: `${snap.window_key}@${iso(snap.computed_at)}`, label: snap.label, source: (snap.sources_used ?? []).join(","), url: null, retrieved_at: iso(snap.computed_at), verification: "automatic" }],
        unanswered: "sin_evidencia",
      };
    }
    const top = snap.entries.slice(0, 5).flatMap((e: any) => (films.has(e.filmId) ? [{ e, f: films.get(e.filmId)! }] : []));
    return {
      intent: "trends",
      text: `En los últimos 7 días, por crecimiento de vistas de tráilers (${(snap.sources_used ?? []).join(", ")}): ${top.map(({ f }, i) => `${i + 1}. ${filmLabel(f)}`).join("; ")}.`,
      items: top.map(({ f }) => ({ label: filmLabel(f), film_id: String(f.id) })),
      citations: [{ type: "trend_snapshot", id: `${snap.window_key}@${iso(snap.computed_at)}`, label: snap.label, source: (snap.sources_used ?? []).join(","), url: null, retrieved_at: iso(snap.computed_at), verification: "automatic" }],
      unanswered: null,
    };
  }

  // ── Festivales: fechas y premios ──
  if (fest && has(q, /\s(premio|premios|premiad[ao]s?|gano|gana|ganaron|ganadoras?|galardon\w*)\s/)) {
    const editions = new Map(rows.editions.filter((e) => e.festival_id === fest.id).map((e) => [e.id, e]));
    const evs = rows.events.filter((e) => e.kind === "award" && editions.has(e.edition_id) && films.has(e.film_id));
    if (evs.length === 0) {
      return { intent: "festival_awards", text: `No tengo premios verificados de películas mexicanas en ${fest.short_name ?? fest.name}.`, items: [], citations: [], unanswered: "sin_datos" };
    }
    return {
      intent: "festival_awards",
      text: `Premios verificados en ${fest.short_name ?? fest.name}: ${evs.map((e) => `${films.get(e.film_id)!.title}, ${e.award_name} (${editions.get(e.edition_id)!.year})`).join("; ")}.`,
      items: evs.map((e) => ({ label: `${films.get(e.film_id)!.title} · ${e.award_name}`, film_id: e.film_id })),
      citations: evs.map((e) => ({ type: "festival_event" as const, id: e.id, label: `${e.award_name} ${editions.get(e.edition_id)!.year}`, source: e.source_id, url: e.source_url ?? null, retrieved_at: iso(e.retrieved_at), verification: e.verification })),
      unanswered: null,
    };
  }
  if (fest && (has(q, /\s(cuando|fecha|fechas|empieza|inicia|termina|sera|edicion)\s/) || !film)) {
    const eds = rows.editions.filter((e) => e.festival_id === fest.id && e.starts_on && !e.is_cancelled);
    const next = eds.filter((e) => (e.ends_on ?? e.starts_on) >= today).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
    if (!next) {
      return { intent: "festival_dates", text: `${fest.short_name ?? fest.name} todavía no tiene fechas confirmadas con fuente para su próxima edición.`, items: [{ label: fest.name, festival_id: fest.id }], citations: [], unanswered: "sin_fecha" };
    }
    return {
      intent: "festival_dates",
      text: `${fest.short_name ?? fest.name} (${next.edition_label}) es ${rango(next.starts_on, next.ends_on)} en ${fest.city}.`,
      items: [{ label: fest.name, festival_id: fest.id }],
      citations: [{ type: "festival_edition", id: next.id, label: `${fest.name} ${next.edition_label}`, source: next.source_id, url: next.source_url ?? null, retrieved_at: iso(next.retrieved_at), verification: next.verification }],
      unanswered: null,
    };
  }

  // ── Personas ──
  if (person && !has(q, /\squien\s/)) {
    const list = rows.films.filter((f) => (directors.get(f.id) ?? []).includes(person.n));
    return {
      intent: "director_films",
      text: `${person.n} dirigió ${list.length === 1 ? "una película" : `${list.length} películas`} en el catálogo: ${list.map(filmLabel).join("; ")}.`,
      items: list.map((f) => ({ label: filmLabel(f), film_id: String(f.id) })),
      citations: list.map(filmCite), unanswered: null,
    };
  }

  // ── Una película ──
  if (filmMatches.length > 1) return clarify();
  if (film && has(q, /\squien(es)?\s(dirig|la dirig|hizo)/)) {
    const ds = directors.get(film.id) ?? [];
    if (ds.length === 0) return { intent: "film_director", text: `No tengo registrada la dirección de ${filmLabel(film)}.`, items: [], citations: [filmCite(film)], unanswered: "sin_datos" };
    return { intent: "film_director", text: `${filmLabel(film)} es de ${ds.join(" y ")}.`, items: [{ label: filmLabel(film), film_id: String(film.id) }], citations: [filmCite(film)], unanswered: null };
  }
  if (film && has(q, /\s(premio|premios|gano|gana|galardon\w*|festival|festivales)\s/)) {
    const evs = rows.events.filter((e) => e.film_id === film.id);
    const festName = (id: string) => { const f = rows.festivals.find((x) => x.id === id); return f?.short_name ?? f?.name ?? "festival"; };
    if (evs.length === 0) return { intent: "film_awards", text: `No tengo selecciones ni premios verificados de ${filmLabel(film)}.`, items: [], citations: [filmCite(film)], unanswered: "sin_datos" };
    return {
      intent: "film_awards",
      text: `${filmLabel(film)}: ${evs.map((e) => `${e.kind === "award" ? e.award_name : e.section ?? "selección"} en ${festName(e.festival_id)}`).join("; ")}.`,
      items: [{ label: filmLabel(film), film_id: String(film.id) }],
      citations: evs.map((e) => ({ type: "festival_event" as const, id: e.id, label: e.award_name ?? e.section ?? e.kind, source: e.source_id, url: e.source_url ?? null, retrieved_at: iso(e.retrieved_at), verification: e.verification })),
      unanswered: null,
    };
  }

  // ── Listas ──
  const year = q.match(/\s((?:19|20)\d\d)\s/)?.[1];
  if (year && !film && has(q, /\s(peliculas|pelicula|cine|estrenos|filmes|cintas|documentales)\s/)) {
    const list = rows.films.filter((f) => String(f.year) === year);
    return {
      intent: "year_films",
      text: list.length === 0 ? `No tengo películas de ${year} en el catálogo.` : `${list.length} películas de ${year} en el catálogo${list.length > 10 ? "; las primeras 10" : ""}: ${list.slice(0, 10).map((f) => f.title).join("; ")}.`,
      items: list.slice(0, 10).map((f) => ({ label: filmLabel(f), film_id: String(f.id) })),
      citations: list.slice(0, 10).map(filmCite), unanswered: list.length ? null : "sin_datos",
    };
  }
  if (!film && has(q, /\s(proxim\w*|por estrenar|se estrena\w*|estrenos|estrena|estreno)\s/)) {
    const list = rows.films.filter((f) => f.mx_release_date && f.mx_release_date >= today)
      .sort((a, b) => a.mx_release_date.localeCompare(b.mx_release_date)).slice(0, 10);
    return {
      intent: "upcoming",
      text: list.length === 0 ? "No tengo estrenos próximos con fecha identificada." : `Próximos estrenos con fecha identificada (no implica funciones confirmadas): ${list.map((f) => `${f.title} (${fecha(f.mx_release_date)})`).join("; ")}.`,
      items: list.map((f) => ({ label: filmLabel(f), film_id: String(f.id) })),
      citations: list.map(filmCite), unanswered: list.length ? null : "sin_datos",
    };
  }

  if (film) {
    const ds = directors.get(film.id) ?? [];
    const evs = rows.events.filter((e) => e.film_id === film.id);
    const revs = rows.reviews.filter((r) => r.film_id === film.id);
    const parts = [ds.length ? `dirigida por ${ds.join(" y ")}` : null, film.mx_release_date ? `estreno identificado: ${fecha(film.mx_release_date)}` : null,
      evs.length ? `${evs.length} ${evs.length === 1 ? "registro" : "registros"} en festivales` : null, revs.length ? `${revs.length} ${revs.length === 1 ? "reseña" : "reseñas"} enlazadas` : null].filter(Boolean);
    return {
      intent: "film_info", text: `${filmLabel(film)}${parts.length ? `: ${parts.join("; ")}` : ""}.`,
      items: [{ label: filmLabel(film), film_id: String(film.id) }],
      citations: [filmCite(film), ...revs.slice(0, 3).map((r) => ({ type: "review" as const, id: r.id, label: `${r.outlet}: ${r.title}`, source: r.source_id, url: r.url, retrieved_at: iso(r.retrieved_at), verification: r.verification }))],
      unanswered: null,
    };
  }
  return { intent: "unknown", text: `No tengo datos verificados para responder eso. ${SUGERENCIAS}`, items: [], citations: [], unanswered: "fuera_de_alcance" };
}
