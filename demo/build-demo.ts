// Genera ios/CineMexa/Resources/DemoData.json con el MISMO contrato JSON que servirá la API.
//
// Todo lo que sale de aquí es ficticio y va marcado con verification = "demo":
// películas, personas, medios, reseñas, funciones y señales de tendencia.
// Los festivales son reales (nombre, ciudad y coordenadas aproximadas de ciudad),
// pero sus fechas y participaciones en el modo demo son inventadas y se etiquetan así.
//
// Las fechas se escriben como tokens relativos ("rel:-3d", "rel:+2d@20:30", "day:+5d")
// para que la demo siempre luzca vigente; la app los resuelve al cargar.
//
// Uso: node demo/build-demo.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeTrendRanking, type TrendObservation, type TrendWindow } from "../packages/core/src/index.ts";

const OUT = join(import.meta.dirname, "..", "ios", "CineMexa", "Resources", "DemoData.json");
const REF = new Date("2026-01-01T00:00:00Z"); // referencia interna para las series; sólo importan los deltas

const rel = (days: number, time?: string) => `rel:${days >= 0 ? "+" : ""}${days}d${time ? "@" + time : ""}`;
const day = (days: number) => `day:${days >= 0 ? "+" : ""}${days}d`;
const demoProv = (sourceUrl: string | null = null) => ({
  source: "demo", source_url: sourceUrl, retrieved_at: rel(0), published_at: null, verification: "demo", confidence: null,
});

// ───────────── Películas ficticias ─────────────
type FilmSeed = {
  slug: string; title: string; year: number; kind: "feature" | "short"; runtime: number;
  genres: string[]; doc?: boolean; anim?: boolean; countries: string[]; part: string;
  directors: string[]; writers: string[]; dp: string[]; cast: string[]; synopsis: string;
  status: string; release?: number | null; alt?: string[];
};

const FILMS: FilmSeed[] = [
  { slug: "la-sal-del-desierto", title: "La sal del desierto", year: 2026, kind: "feature", runtime: 104, genres: ["Drama"], countries: ["MX"], part: "majority",
    directors: ["Mariana Olvera Téllez"], writers: ["Mariana Olvera Téllez", "Iván Cárdenas"], dp: ["Rocío Benavides"], cast: ["Luz Arreola", "Tomás Quiroga", "Celia Ruvalcaba"],
    synopsis: "Una salinera de Baja California Sur decide quedarse en el pueblo que todos abandonan. (Sinopsis ficticia de demostración.)", status: "in_theaters", release: -6, alt: ["Desert Salt"] },
  { slug: "ruido-blanco", title: "Ruido blanco", year: 2026, kind: "feature", runtime: 88, genres: ["Documental"], doc: true, countries: ["MX", "FR"], part: "coproduction",
    directors: ["Ernesto Lugo"], writers: ["Ernesto Lugo"], dp: ["Paula Esquivel"], cast: [],
    synopsis: "Un sonidista recorre mercados de la Ciudad de México grabando lo que nadie escucha. (Demo.)", status: "festival", release: null },
  { slug: "los-ultimos-cometas", title: "Los últimos cometas", year: 2026, kind: "feature", runtime: 92, genres: ["Animación", "Aventura"], anim: true, countries: ["MX"], part: "majority",
    directors: ["Sofía Arce", "Bruno Malpica"], writers: ["Sofía Arce"], dp: [], cast: ["Voz: Regina Solís", "Voz: Abel Ochoa"],
    synopsis: "Dos hermanos construyen un telescopio con chatarra para ver el último cometa del siglo. (Demo.)", status: "upcoming", release: 18 },
  { slug: "marea-de-papel", title: "Marea de papel", year: 2026, kind: "short", runtime: 14, genres: ["Drama"], countries: ["MX"], part: "majority",
    directors: ["Daniela Ponce"], writers: ["Daniela Ponce"], dp: ["Hugo Sandoval"], cast: ["Mía Herrera"],
    synopsis: "Una niña dobla barcos con los avisos de desalojo de su edificio. (Demo.)", status: "festival", release: null },
  { slug: "tierra-que-habla", title: "Tierra que habla", year: 2025, kind: "short", runtime: 22, genres: ["Documental"], doc: true, countries: ["MX"], part: "majority",
    directors: ["Yolotl Mendoza"], writers: ["Yolotl Mendoza"], dp: ["Yolotl Mendoza"], cast: [],
    synopsis: "Una comunidad mixteca registra en su lengua la historia de su territorio. (Demo.)", status: "festival", release: null },
  { slug: "domingo-siete", title: "Domingo siete", year: 2026, kind: "feature", runtime: 97, genres: ["Comedia"], countries: ["MX"], part: "majority",
    directors: ["Rafael Anaya"], writers: ["Rafael Anaya", "Lorena Villa"], dp: ["Martín Ugalde"], cast: ["Gael Montiel", "Ximena Lara", "Pedro Cota"],
    synopsis: "Una boda en Guadalajara se complica cuando aparece un invitado que nadie recuerda haber invitado. (Demo.)", status: "release_identified", release: -2 },
  { slug: "el-eco-de-la-presa", title: "El eco de la presa", year: 2026, kind: "feature", runtime: 111, genres: ["Thriller"], countries: ["MX", "ES"], part: "coproduction",
    directors: ["Andrés Villalobos"], writers: ["Andrés Villalobos", "Nuria Sáez"], dp: ["Lucía Garmendia"], cast: ["Diego Zamudio", "Elena Ortiz"],
    synopsis: "Una ingeniera investiga desapariciones alrededor de una presa en la Sierra Madre. (Demo.)", status: "festival", release: 40, alt: ["The Dam's Echo"] },
  { slug: "nopalera", title: "Nopalera", year: 2026, kind: "short", runtime: 9, genres: ["Animación"], anim: true, countries: ["MX"], part: "majority",
    directors: ["Carla Ibarra"], writers: ["Carla Ibarra"], dp: [], cast: [],
    synopsis: "Un nopal decide caminar hasta el mar. Animación cuadro por cuadro. (Demo.)", status: "festival", release: null },
  { slug: "hija-del-volcan", title: "Hija del volcán", year: 2025, kind: "feature", runtime: 101, genres: ["Drama"], countries: ["MX", "AR"], part: "coproduction",
    directors: ["Fernanda Lomelí"], writers: ["Fernanda Lomelí"], dp: ["Joaquín Peralta"], cast: ["Renata Gil", "Aurelio Bravo"],
    synopsis: "Tras la erupción, una adolescente vuelve sola a buscar la casa familiar. (Demo.)", status: "archive", release: -240 },
  { slug: "cuarto-oscuro", title: "Cuarto oscuro", year: 2026, kind: "feature", runtime: 86, genres: ["Terror"], countries: ["MX"], part: "majority",
    directors: ["Óscar Medrano"], writers: ["Óscar Medrano"], dp: ["Valeria Kuri"], cast: ["Itzel Paredes", "Samuel Rangel"],
    synopsis: "Un fotógrafo de bodas descubre que sus negativos revelan a alguien más. (Demo.)", status: "upcoming", release: 33 },
];

const films = FILMS.map((f, i) => ({
  id: `film-${String(i + 1).padStart(2, "0")}`,
  slug: f.slug, title: f.title, original_title: f.title, alt_titles: f.alt ?? [], year: f.year, kind: f.kind,
  runtime_minutes: f.runtime, countries: f.countries, mx_participation: f.part, genres: f.genres,
  is_documentary: !!f.doc, is_animation: !!f.anim, synopsis: f.synopsis,
  poster: null, backdrop: null, // la demo nunca inventa pósters: la app muestra el placeholder
  directors: f.directors, writers: f.writers, cinematographers: f.dp, cast: f.cast,
  trailer_url: null, status: f.status, mx_release_date: f.release == null ? null : day(f.release),
  provenance: demoProv(),
}));
const filmId = (slug: string) => films.find((f) => f.slug === slug)!.id;

// ───────────── Festivales reales (ediciones ficticias) ─────────────
// Coordenadas a nivel ciudad/sede aproximada. En Live Mode las coordenadas vienen
// verificadas desde la tabla venues del backend.
const FESTIVALS = [
  { slug: "ficg", name: "Festival Internacional de Cine en Guadalajara", short: "FICG", city: "Guadalajara", country: "MX", lat: 20.6597, lon: -103.3496, web: "https://www.ficg.mx", focus: [] as string[], start: -2, len: 9, tz: "America/Mexico_City", call: null as number | null },
  { slug: "ficm", name: "Festival Internacional de Cine de Morelia", short: "FICM", city: "Morelia", country: "MX", lat: 19.7027, lon: -101.1923, web: "https://moreliafilmfest.com", focus: ["shorts", "documentary"], start: 12, len: 10, tz: "America/Mexico_City", call: 5 },
  { slug: "giff", name: "Festival Internacional de Cine de Guanajuato", short: "GIFF", city: "Guanajuato", country: "MX", lat: 21.0190, lon: -101.2574, web: "https://giff.mx", focus: ["shorts"], start: -40, len: 8, tz: "America/Mexico_City", call: 60 },
  { slug: "ficunam", name: "Festival Internacional de Cine UNAM", short: "FICUNAM", city: "Ciudad de México", country: "MX", lat: 19.3142, lon: -99.1846, web: "https://ficunam.unam.mx", focus: [], start: 45, len: 10, tz: "America/Mexico_City", call: 9 },
  { slug: "ambulante", name: "Ambulante Gira de Documentales", short: "Ambulante", city: "Ciudad de México", country: "MX", lat: 19.4326, lon: -99.1332, web: "https://www.ambulante.org", focus: ["documentary"], start: 70, len: 30, tz: "America/Mexico_City", call: 21 },
  { slug: "docsmx", name: "DocsMX Festival Internacional de Cine Documental", short: "DocsMX", city: "Ciudad de México", country: "MX", lat: 19.3600, lon: -99.1640, web: "https://docsmx.org", focus: ["documentary"], start: -70, len: 9, tz: "America/Mexico_City", call: null },
  { slug: "los-cabos", name: "Festival Internacional de Cine de Los Cabos", short: "Los Cabos", city: "San José del Cabo", country: "MX", lat: 23.0610, lon: -109.6970, web: "https://cabosfilmfest.com", focus: [], start: 25, len: 5, tz: "America/Mazatlan", call: null },
  { slug: "berlinale", name: "Berlinale", short: "Berlinale", city: "Berlín", country: "DE", lat: 52.5096, lon: 13.3736, web: "https://www.berlinale.de", focus: [], start: 80, len: 11, tz: "Europe/Berlin", call: 14 },
  { slug: "cannes", name: "Festival de Cannes", short: "Cannes", city: "Cannes", country: "FR", lat: 43.5513, lon: 7.0175, web: "https://www.festival-cannes.com", focus: [], start: -190, len: 12, tz: "Europe/Paris", call: null },
  { slug: "sundance", name: "Sundance Film Festival", short: "Sundance", city: "Park City", country: "US", lat: 40.6461, lon: -111.4980, web: "https://festival.sundance.org", focus: [], start: 55, len: 11, tz: "America/Denver", call: null },
  { slug: "san-sebastian", name: "Festival de San Sebastián", short: "San Sebastián", city: "San Sebastián", country: "ES", lat: 43.3243, lon: -1.9783, web: "https://www.sansebastianfestival.com", focus: [], start: -60, len: 10, tz: "Europe/Madrid", call: null },
  { slug: "locarno", name: "Locarno Film Festival", short: "Locarno", city: "Locarno", country: "CH", lat: 46.1690, lon: 8.7955, web: "https://www.locarnofestival.ch", focus: [], start: -110, len: 11, tz: "Europe/Zurich", call: null },
  { slug: "venecia", name: "Mostra Internacional de Arte Cinematográfico de Venecia", short: "Venecia", city: "Venecia (Lido)", country: "IT", lat: 45.4060, lon: 12.3680, web: "https://www.labiennale.org/en/cinema", focus: [], start: -85, len: 11, tz: "Europe/Rome", call: null },
  { slug: "clermont-ferrand", name: "Festival du Court Métrage de Clermont-Ferrand", short: "Clermont-Ferrand", city: "Clermont-Ferrand", country: "FR", lat: 45.7772, lon: 3.0870, web: "https://clermont-filmfest.org", focus: ["shorts"], start: 3, len: 9, tz: "Europe/Paris", call: 30 },
];

const festivals = FESTIVALS.map((f, i) => ({
  id: `fest-${String(i + 1).padStart(2, "0")}`,
  slug: f.slug, name: f.name, short_name: f.short, city: f.city, country: f.country, website_url: f.web, focus: f.focus,
  venue: { name: f.short, city: f.city, country: f.country, latitude: f.lat, longitude: f.lon, coordinate_precision: "city" },
  editions: [{
    id: `ed-${String(i + 1).padStart(2, "0")}`,
    label: "Edición demo", year: 2026,
    starts_on: day(f.start), ends_on: day(f.start + f.len - 1), timezone: f.tz,
    program_url: f.web, call_url: f.call == null ? null : f.web,
    call_deadline: f.call == null ? null : rel(f.call, "23:59"),
    is_cancelled: false, provenance: demoProv(f.web),
  }],
  provenance: { ...demoProv(f.web), verification: "demo" },
}));
const fest = (slug: string) => festivals.find((f) => f.slug === slug)!;
const ed = (slug: string) => fest(slug).editions[0];
const festStart = (slug: string) => FESTIVALS.find((f) => f.slug === slug)!.start;

// ───────────── Participaciones en festivales ─────────────
type Ev = [film: string, festival: string, kind: "selection" | "screening" | "award" | "premiere", offsetFromStart: number | null, section: string | null, award?: string];
const EVENTS: Ev[] = [
  ["ruido-blanco", "ficg", "selection", null, "Largometraje documental"],
  ["ruido-blanco", "ficg", "screening", 2, "Largometraje documental"],
  ["ruido-blanco", "ficg", "screening", 5, "Largometraje documental"],
  ["ruido-blanco", "docsmx", "award", 7, "Competencia mexicana", "Premio del público (demo)"],
  ["marea-de-papel", "clermont-ferrand", "selection", null, "Competencia internacional"],
  ["marea-de-papel", "clermont-ferrand", "screening", 2, "Competencia internacional"],
  ["marea-de-papel", "ficm", "selection", null, "Cortometraje mexicano"],
  ["marea-de-papel", "giff", "award", 6, "Cortometraje", "Mejor cortometraje (demo)"],
  ["tierra-que-habla", "ficm", "screening", 3, "Documental mexicano"],
  ["tierra-que-habla", "ambulante", "selection", null, "Gira 2027"],
  ["el-eco-de-la-presa", "san-sebastian", "premiere", 1, "Horizontes Latinos"],
  ["el-eco-de-la-presa", "san-sebastian", "award", 8, "Horizontes Latinos", "Mención especial (demo)"],
  ["el-eco-de-la-presa", "los-cabos", "screening", 2, "Competencia"],
  ["nopalera", "clermont-ferrand", "screening", 4, "Competencia Labo"],
  ["nopalera", "berlinale", "selection", null, "Generation Kplus"],
  ["la-sal-del-desierto", "cannes", "premiere", 4, "Selección paralela (demo)"],
  ["la-sal-del-desierto", "locarno", "screening", 3, "Fuera de competencia"],
  ["la-sal-del-desierto", "ficg", "screening", 1, "Gala"],
  ["los-ultimos-cometas", "ficunam", "selection", null, "Funciones especiales"],
  ["hija-del-volcan", "venecia", "selection", null, "Orizzonti"],
  ["hija-del-volcan", "venecia", "screening", 5, "Orizzonti"],
  ["cuarto-oscuro", "sundance", "selection", null, "Midnight"],
];

const festival_events = EVENTS.map(([film, f, kind, off, section, award], i) => ({
  id: `fev-${String(i + 1).padStart(2, "0")}`,
  edition_id: ed(f).id, festival_id: fest(f).id, film_id: filmId(film), kind, section,
  award_name: award ?? null,
  // Selecciones sin fecha de proyección confirmada: occurs_at null, announced_at con fecha.
  occurs_at: off == null ? null : rel(festStart(f) + off, "19:00"),
  announced_at: rel(festStart(f) - 30),
  provenance: demoProv(fest(f).website_url),
}));

// ───────────── Funciones en salas (ficticias) ─────────────
const VENUES = [
  { name: "Sala Demo Centro", city: "Ciudad de México", country: "MX", latitude: 19.4326, longitude: -99.1332, coordinate_precision: "city" },
  { name: "Cineclub Demo Tlaquepaque", city: "Guadalajara", country: "MX", latitude: 20.6408, longitude: -103.3117, coordinate_precision: "city" },
  { name: "Cineteca Demo Norte", city: "Monterrey", country: "MX", latitude: 25.6866, longitude: -100.3161, coordinate_precision: "city" },
];
const screenings: unknown[] = [];
let sc = 0;
for (const [slug, venueIdx, kind, d, time] of [
  ["la-sal-del-desierto", 0, "commercial", 0, "18:30"], ["la-sal-del-desierto", 0, "commercial", 1, "21:00"],
  ["la-sal-del-desierto", 2, "cineteca", 2, "17:00"], ["la-sal-del-desierto", 1, "cineclub", 4, "20:00"],
  ["tierra-que-habla", 1, "cineclub", 3, "19:30"],
] as const) {
  screenings.push({
    id: `scr-${++sc}`, film_id: filmId(slug), venue: VENUES[venueIdx], kind, starts_at: rel(d, time),
    ticket_url: "https://example.com/demo/boletos", provenance: demoProv(),
  });
}

const streaming = [
  { film_id: filmId("hija-del-volcan"), provider: "Plataforma Demo", offer_type: "subscription", url: "https://example.com/demo/streaming", provenance: demoProv() },
];

// ───────────── Crítica ficticia ─────────────
const REVIEWS = [
  ["la-sal-del-desierto", "Encuadre (revista demo)", "Paulina Reyes", "Quedarse también es un acto político", -3, null, null, "Extracto autorizado de demostración: «una película que respira con el viento del desierto»."],
  ["la-sal-del-desierto", "Butaca Demo", null, "La sal del desierto: paisaje y resistencia", -5, null, null, null],
  ["la-sal-del-desierto", "Alianza editorial demo", "Jorge Salinas", "Una ópera prima contenida y precisa", -1, 8.5, 10, null],
  ["ruido-blanco", "Crítica Independiente (demo)", "Ana Lucía Garza", "Escuchar la ciudad", -7, null, null, null],
  ["el-eco-de-la-presa", "Encuadre (revista demo)", "Paulina Reyes", "Thriller con agua al cuello", -55, null, null, null],
  ["domingo-siete", "Butaca Demo", null, "Domingo siete y la comedia de enredos", -1, null, null, null],
  ["hija-del-volcan", "Crítica Independiente (demo)", "Rubén Aldana", "Ceniza y memoria", -230, null, null, null],
  ["marea-de-papel", "Cortos en foco (demo)", "Itzel Navarro", "Catorce minutos que no se olvidan", -12, null, null, null],
] as const;
const reviews = REVIEWS.map(([slug, outlet, critic, title, d, score, scale, excerpt], i) => ({
  id: `rev-${i + 1}`, film_id: filmId(slug), outlet, critic_name: critic, title,
  url: `https://example.com/demo/critica/${slug}-${i + 1}`, published_at: rel(d, "09:00"),
  score, score_scale: scale, excerpt, is_automated_summary: false, provenance: demoProv(`https://example.com/demo/critica/${slug}-${i + 1}`),
}));
reviews.push({
  id: "rev-summary-1", film_id: filmId("la-sal-del-desierto"), outlet: "Cine Mexa", critic_name: null,
  title: "Resumen automatizado de la crítica", url: reviews[0].url, published_at: rel(0, "08:00"), score: null, score_scale: null,
  excerpt: "Resumen automatizado (demo): las reseñas enlazadas destacan el paisaje y la contención de la puesta en escena.",
  is_automated_summary: true, provenance: demoProv(reviews[0].url),
} as any);

// ───────────── Recorrido (timeline) ─────────────
const timeline: unknown[] = [];
let tl = 0;
for (const e of festival_events) {
  const f = festivals.find((x) => x.id === e.festival_id)!;
  const label = e.kind === "award" ? `${e.award_name} · ${f.short_name}`
    : e.kind === "premiere" ? `Estreno mundial · ${f.short_name}`
    : e.kind === "selection" ? `Selección oficial · ${f.short_name}` : `Proyección · ${f.short_name}`;
  timeline.push({ id: `tl-${++tl}`, film_id: e.film_id, kind: e.kind === "screening" ? "festival_screening" : e.kind === "selection" ? "festival_selection" : e.kind,
    date: e.occurs_at ?? e.announced_at, label, place: `${f.city}, ${f.country}`, provenance: e.provenance });
}
for (const f of films) {
  if (f.mx_release_date) timeline.push({ id: `tl-${++tl}`, film_id: f.id, kind: "theatrical_release",
    date: (f.mx_release_date as string).replace("day:", "rel:"), label: "Estreno en salas de México", place: "México", provenance: demoProv() });
}
timeline.push({ id: `tl-${++tl}`, film_id: filmId("hija-del-volcan"), kind: "streaming", date: rel(-120), label: "Llega a streaming en México", place: "Plataforma Demo", provenance: demoProv() });

// ───────────── Noticias ficticias ─────────────
const NEWS = [
  ["selection", "«Marea de papel» compite en Clermont-Ferrand (demo)", "marea-de-papel", "clermont-ferrand", -4],
  ["award", "«Ruido blanco» gana el premio del público en DocsMX (demo)", "ruido-blanco", "docsmx", -62],
  ["premiere", "«La sal del desierto» llega a salas mexicanas (demo)", "la-sal-del-desierto", null, -6],
  ["call", "Abre convocatoria de cortometraje en FICM (demo)", null, "ficm", -10],
  ["call", "FICUNAM recibe largometrajes hasta fin de mes (demo)", null, "ficunam", -2],
  ["selection", "«Cuarto oscuro» seleccionada en Sundance Midnight (demo)", "cuarto-oscuro", "sundance", -1],
  ["publication", "Lo que viene en animación mexicana (demo)", "los-ultimos-cometas", null, 0],
  ["industry", "Coproducciones México–España en San Sebastián (demo)", "el-eco-de-la-presa", "san-sebastian", -58],
] as const;
const news = NEWS.map(([kind, title, film, f, d], i) => ({
  id: `news-${i + 1}`, kind, title, url: `https://example.com/demo/noticias/${i + 1}`, outlet: "Noticias demo",
  published_at: rel(d, "10:00"), film_id: film ? filmId(film) : null, festival_id: f ? fest(f).id : null,
  provenance: demoProv(`https://example.com/demo/noticias/${i + 1}`),
}));

// ───────────── Señales de tendencia sintéticas ─────────────
// Serie horaria determinista por película: base + pico de interés.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const PROFILES: Record<string, { base: number; peakDay: number; peak: number; media: number }> = {
  "la-sal-del-desierto": { base: 80, peakDay: -4, peak: 9, media: 0.25 },
  "domingo-siete": { base: 120, peakDay: -1, peak: 6, media: 0.15 },
  "cuarto-oscuro": { base: 30, peakDay: -0.5, peak: 14, media: 0.08 },
  "marea-de-papel": { base: 10, peakDay: -3, peak: 12, media: 0.06 },
  "ruido-blanco": { base: 25, peakDay: -20, peak: 5, media: 0.07 },
  "el-eco-de-la-presa": { base: 60, peakDay: -55, peak: 4, media: 0.1 },
  "hija-del-volcan": { base: 400, peakDay: -200, peak: 1.2, media: 0.05 }, // grande pero plana
  "los-ultimos-cometas": { base: 40, peakDay: -9, peak: 4, media: 0.05 },
  "nopalera": { base: 2, peakDay: -2, peak: 3, media: 0.01 }, // sin evidencia suficiente
  // "tierra-que-habla" sin señales digitales: nunca aparece en Trends.
};
const HOURS = 24 * 130;
const obs: TrendObservation[] = [];
for (const [slug, p] of Object.entries(PROFILES)) {
  const r = rng(slug.length * 7919);
  for (let h = HOURS; h >= 1; h--) {
    const t = new Date(REF.getTime() - h * 3600_000);
    const dayOffset = -h / 24;
    const bump = 1 + p.peak * Math.exp(-((dayOffset - p.peakDay) ** 2) / 8);
    const views = Math.round(p.base * bump * (0.8 + 0.4 * r()));
    obs.push({ filmId: filmId(slug), source: "youtube", metric: "views_delta", observedAt: t.toISOString(), value: views });
    if (r() < p.media * bump / 6) obs.push({ filmId: filmId(slug), source: "media", metric: "mentions", observedAt: t.toISOString(), value: 1 });
  }
}

function toRel(iso: string): string {
  const days = Math.round((Date.parse(iso) - REF.getTime()) / 86_400_000 * 100) / 100;
  const whole = Math.round(days);
  return rel(whole);
}

const windows: TrendWindow[] = ["24h", "7d", "30d"];
const trends = windows.map((w) => {
  const ranking = computeTrendRanking(obs, { window: w, now: REF });
  const step = w === "24h" ? 3 : w === "7d" ? 24 : 72; // horas entre puntos del histórico
  const history: { date: string; film_id: string; score: number }[] = [];
  for (let k = 9; k >= 0; k--) {
    const at = new Date(REF.getTime() - k * step * 3600_000);
    const r = computeTrendRanking(obs, { window: w, now: at, limit: 50 });
    for (const e of ranking.entries) {
      const hit = r.entries.find((x) => x.filmId === e.filmId);
      history.push({ date: k === 0 ? rel(0) : `rel:-${Math.round(k * step)}h`, film_id: e.filmId, score: hit ? hit.score : 0 });
    }
  }
  return {
    window: w, computed_at: toRel(ranking.computedAt), label: ranking.label, sources_used: ranking.sourcesUsed,
    methodology_version: ranking.methodologyVersion, is_demo: true,
    entries: ranking.entries.map((e) => ({
      film_id: e.filmId, rank: e.rank, previous_rank: e.previousRank, score: e.score, explanation: e.explanation,
      signals: e.signals.map((s) => ({ source: s.source, metric: s.metric, current: s.current, baseline: s.baseline, growth_pct: s.growthPct })),
    })),
    history,
  };
});

// ───────────── Salida ─────────────
const snapshot = {
  meta: {
    mode: "demo", api_version: "1", generated_at: rel(0),
    notice: "Datos de demostración: películas, personas, medios, reseñas, funciones, fechas y métricas son ficticios.",
    sources: [
      { id: "demo", name: "Datos de demostración", attribution: "Contenido ficticio generado para probar la app.", last_sync_at: rel(0), status: "ok" },
      { id: "wikidata", name: "Wikidata", attribution: "Datos de Wikidata (CC0)", last_sync_at: null, status: "not_configured" },
      { id: "tmdb", name: "TMDB", attribution: "This product uses the TMDB API but is not endorsed or certified by TMDB.", last_sync_at: null, status: "not_configured" },
      { id: "youtube", name: "YouTube Data API", attribution: "Datos de YouTube", last_sync_at: null, status: "not_configured" },
    ],
  },
  films, screenings, streaming, reviews, timeline, festivals, festival_events, news, trends,
};

writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
console.log(`DemoData.json: ${films.length} películas, ${festivals.length} festivales, ${festival_events.length} participaciones, ${reviews.length} reseñas`);
for (const t of trends) console.log(`  ${t.window}: ${t.entries.map((e) => `${e.rank}.${films.find((f) => f.id === e.film_id)!.slug}(${e.score})`).join(" ")}`);
