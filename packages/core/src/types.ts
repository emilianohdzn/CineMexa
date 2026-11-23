// Contratos de datos compartidos entre collectors, Edge Functions y la API que consume la app.
// La app iOS tiene modelos Codable equivalentes en ios/CineMexa/Core/Models/Models.swift.
// Todas las fechas viajan como ISO 8601 en UTC.

export type VerificationStatus =
  | "verified" // confirmado por fuente oficial o curaduría
  | "editorial" // capturado manualmente por el equipo editorial
  | "automatic" // ingerido automáticamente, sin revisión humana
  | "unverified" // dato candidato, no debe mostrarse como hecho
  | "demo"; // dato ficticio del modo demostración

export interface Provenance {
  source: string; // clave de la tabla sources, p. ej. "wikidata", "tmdb", "editorial"
  sourceUrl: string | null;
  retrievedAt: string; // cuándo se consultó
  publishedAt?: string | null; // cuándo lo publicó la fuente
  verification: VerificationStatus;
  confidence?: number | null; // 0..1
}

export type FilmKind = "feature" | "short";
export type MexicanParticipation = "majority" | "coproduction" | "minority" | "unknown";

export interface ExternalIds {
  wikidata?: string | null; // Q-id canónico
  tmdb?: number | null;
  imdb?: string | null;
}

export interface FilmCandidate {
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  kind?: FilmKind;
  runtimeMinutes?: number | null;
  countries?: string[]; // ISO 3166-1 alpha-2
  directors?: string[];
  ids: ExternalIds;
  provenance: Provenance;
}

export type TrendSource = "youtube" | "google_trends" | "media" | (string & {});

export interface TrendObservation {
  filmId: string;
  source: TrendSource;
  metric: string; // p. ej. "views_delta", "mentions"
  observedAt: string; // ISO; inicio del intervalo agregado
  value: number; // conteo en el intervalo (no acumulado)
}

export interface TrendSignalSummary {
  source: TrendSource;
  metric: string;
  current: number;
  baseline: number;
  growthPct: number | null; // null si la línea base es 0
  component: number;
}

export interface TrendEntry {
  filmId: string;
  rank: number;
  previousRank: number | null;
  score: number; // índice 0..100
  rawScore: number;
  signals: TrendSignalSummary[];
  explanation: string;
}

export interface TrendRanking {
  window: "24h" | "7d" | "30d";
  computedAt: string;
  label: string; // "Tendencias digitales" o "Las 5 que están dando de qué hablar"
  sourcesUsed: TrendSource[];
  entries: TrendEntry[];
  methodologyVersion: string;
}
