// trend_score v1 — metodología documentada en docs/TRENDS-METHODOLOGY.md.
//
// Para cada película y fuente:
//   current  = suma del periodo actual (ventana W)
//   baseline = promedio de las K ventanas anteriores
//   growth   = ln((current + α) / (baseline + α))   (α amortigua conteos pequeños)
//   activity = ln(1 + current)
// Cada señal se estandariza de forma robusta entre las películas candidatas
// (mediana y MAD), de modo que una película con audiencia histórica enorme no
// gana sólo por tamaño. componente = 0.7·z(growth) + 0.3·z(activity).
// score = promedio ponderado de componentes por fuente activa.
// Sólo entran películas con evidencia mínima en al menos una fuente digital.

import type { TrendEntry, TrendObservation, TrendRanking, TrendSignalSummary, TrendSource } from "./types.ts";

export const METHODOLOGY_VERSION = "trend_score/1.0";

export type TrendWindow = "24h" | "7d" | "30d";
export const WINDOW_HOURS: Record<TrendWindow, number> = { "24h": 24, "7d": 168, "30d": 720 };

export interface SourceConfig {
  weight: number;
  /** true = popularidad digital (YouTube, Trends). false = señal de medios, se reporta aparte. */
  digital: boolean;
  /** evidencia mínima en el periodo actual para que la fuente cuente como "suficiente". */
  minEvidence: number;
  /** suavizado α en la razón de crecimiento. */
  alpha: number;
  label: string;
  unit: string;
}

export const DEFAULT_SOURCES: Record<string, SourceConfig> = {
  youtube: { weight: 0.6, digital: true, minEvidence: 500, alpha: 200, label: "YouTube", unit: "visualizaciones" },
  google_trends: { weight: 0.6, digital: true, minEvidence: 5, alpha: 5, label: "Google Trends", unit: "interés" },
  media: { weight: 0.4, digital: false, minEvidence: 2, alpha: 2, label: "Medios", unit: "menciones" },
};

export interface ComputeOptions {
  window: TrendWindow;
  now: Date;
  baselineWindows?: number; // K
  sources?: Record<string, SourceConfig>;
  limit?: number;
  /** Película → título, sólo para la explicación. */
  titles?: Record<string, string>;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Estandarización robusta. Si todos los valores son iguales devuelve ceros. */
export function robustZ(values: number[]): number[] {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med))) * 1.4826;
  if (mad === 0) {
    const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length || 1));
    if (sd === 0) return values.map(() => 0);
    return values.map((v) => (v - mean) / sd);
  }
  return values.map((v) => (v - med) / mad);
}

/** Índice 0..100 legible a partir del score crudo (logística). */
export function toIndex(raw: number): number {
  return Math.round(100 / (1 + Math.exp(-raw)));
}

interface Agg { current: number; baseline: number }

function aggregate(obs: TrendObservation[], end: number, hours: number, k: number): Map<string, Map<string, Agg>> {
  const w = hours * 3600_000;
  const start = end - w;
  const baseStart = start - k * w;
  const out = new Map<string, Map<string, Agg>>();
  for (const o of obs) {
    const t = Date.parse(o.observedAt);
    if (!(t >= baseStart && t < end)) continue;
    const key = `${o.source}`;
    let bySource = out.get(o.filmId);
    if (!bySource) out.set(o.filmId, (bySource = new Map()));
    let agg = bySource.get(key);
    if (!agg) bySource.set(key, (agg = { current: 0, baseline: 0 }));
    if (t >= start) agg.current += o.value;
    else agg.baseline += o.value / k;
  }
  return out;
}

function rankAt(obs: TrendObservation[], opts: Required<Omit<ComputeOptions, "titles">> & { titles: Record<string, string> }, end: number) {
  const hours = WINDOW_HOURS[opts.window];
  const aggs = aggregate(obs, end, hours, opts.baselineWindows);
  const activeSources = [...new Set(obs.map((o) => o.source))].filter((s) => opts.sources[s]);
  const films = [...aggs.keys()];

  // Componentes por fuente.
  const components = new Map<string, Map<string, TrendSignalSummary>>();
  for (const s of activeSources) {
    const cfg = opts.sources[s];
    const rows = films.map((f) => aggs.get(f)!.get(s) ?? { current: 0, baseline: 0 });
    const growth = rows.map((r) => Math.log((r.current + cfg.alpha) / (r.baseline + cfg.alpha)));
    const activity = rows.map((r) => Math.log1p(r.current));
    const zg = robustZ(growth);
    const za = robustZ(activity);
    films.forEach((f, i) => {
      let m = components.get(f);
      if (!m) components.set(f, (m = new Map()));
      const r = rows[i];
      m.set(s, {
        source: s,
        metric: cfg.unit,
        current: Math.round(r.current),
        baseline: Math.round(r.baseline * 10) / 10,
        growthPct: r.baseline > 0 ? Math.round(((r.current - r.baseline) / r.baseline) * 100) : null,
        component: 0.7 * zg[i] + 0.3 * za[i],
      });
    });
  }

  const scored = films
    .map((f) => {
      const sig = components.get(f)!;
      const eligible = activeSources.some((s) => opts.sources[s].digital && (sig.get(s)?.current ?? 0) >= opts.sources[s].minEvidence);
      let num = 0, den = 0;
      for (const s of activeSources) {
        num += opts.sources[s].weight * sig.get(s)!.component;
        den += opts.sources[s].weight;
      }
      return { filmId: f, raw: den ? num / den : 0, signals: [...sig.values()], eligible };
    })
    .filter((x) => x.eligible)
    .sort((a, b) => b.raw - a.raw || a.filmId.localeCompare(b.filmId));

  return { scored, activeSources };
}

function explain(signals: TrendSignalSummary[], sources: Record<string, SourceConfig>): string {
  const best = [...signals].sort((a, b) => b.component - a.component)[0];
  if (!best) return "Sin señales suficientes.";
  const cfg = sources[best.source];
  const fmt = new Intl.NumberFormat("es-MX");
  const growth =
    best.growthPct === null
      ? `${fmt.format(best.current)} ${cfg.unit} sin actividad en el periodo anterior`
      : best.growthPct >= 0
        ? `${cfg.unit} +${fmt.format(best.growthPct)}% frente al periodo anterior`
        : `${cfg.unit} ${fmt.format(best.growthPct)}% frente al periodo anterior`;
  return `${cfg.label}: ${growth}.`;
}

/** Calcula el ranking para una ventana. Nunca rellena con películas sin evidencia. */
export function computeTrendRanking(observations: TrendObservation[], options: ComputeOptions): TrendRanking {
  const opts = {
    window: options.window,
    now: options.now,
    baselineWindows: options.baselineWindows ?? 3,
    sources: options.sources ?? DEFAULT_SOURCES,
    limit: options.limit ?? 5,
    titles: options.titles ?? {},
  };
  const end = opts.now.getTime();
  const { scored, activeSources } = rankAt(observations, opts, end);
  const prev = rankAt(observations, opts, end - WINDOW_HOURS[opts.window] * 3600_000).scored;
  const prevRank = new Map(prev.map((p, i) => [p.filmId, i + 1]));

  const entries: TrendEntry[] = scored.slice(0, opts.limit).map((s, i) => ({
    filmId: s.filmId,
    rank: i + 1,
    previousRank: prevRank.get(s.filmId) ?? null,
    score: toIndex(s.raw),
    rawScore: Math.round(s.raw * 1000) / 1000,
    signals: s.signals,
    explanation: explain(s.signals, opts.sources),
  }));

  return {
    window: opts.window,
    computedAt: opts.now.toISOString(),
    label: rankingLabel(activeSources as TrendSource[]),
    sourcesUsed: activeSources as TrendSource[],
    entries,
    methodologyVersion: METHODOLOGY_VERSION,
  };
}

/** Si sólo hay YouTube y medios, el ranking se llama "Tendencias digitales". */
export function rankingLabel(sources: TrendSource[]): string {
  const onlyBasic = sources.every((s) => s === "youtube" || s === "media");
  return onlyBasic ? "Tendencias digitales" : "Las 5 que están dando de qué hablar";
}
