// Collector de YouTube: visualizaciones de los tráilers oficiales registrados (films.trailer_url).
// Guarda la diferencia de visualizaciones entre consultas en trend_signals (no el acumulado),
// que es lo que usa trend_score. Cuota: videos.list cuesta 1 unidad por llamada de hasta 50 videos.
// Uso: YOUTUBE_API_KEY=... DATABASE_URL=... node backend/collectors/youtube/run.ts
import { fileURLToPath } from "node:url";
import { fetchJson, type FetchOptions } from "../lib/http.ts";
import { openPostgres, type Db } from "../lib/db.ts";
import { finishRun, recordSource, startRun, type RunStatus } from "../lib/runs.ts";

export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const HOUR = 3_600_000;

/** Id de video de URLs watch, youtu.be, embed o shorts. */
export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

interface VideosResponse { items: Array<{ id: string; statistics?: { viewCount?: string } }> }

export interface YoutubeRunOptions {
  apiKey: string;
  now?: () => Date;
  /** Máximo de unidades de cuota por corrida (cada unidad = 50 videos). */
  maxUnits?: number;
  http?: Omit<FetchOptions, "headers">;
}

export async function runYoutubeViews(db: Db, opts: YoutubeRunOptions) {
  if (!opts.apiKey) throw new Error("Falta YOUTUBE_API_KEY: el conector de YouTube está deshabilitado.");
  const { now = () => new Date(), maxUnits = 50, http = {} } = opts;
  const runId = await startRun(db, "youtube", "trailer_views", { maxUnits });
  const { rows } = await db.query<{ id: string; trailer_url: string }>(
    "select id::text, trailer_url from films where trailer_url is not null and merged_into is null and published");
  const byVideo = new Map<string, string>();
  for (const r of rows) { const v = youtubeVideoId(r.trailer_url); if (v && !byVideo.has(v)) byVideo.set(v, r.id); }
  const ids = [...byVideo.keys()].slice(0, maxUnits * 50);

  let signals = 0;
  const errors: string[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    let res: VideosResponse;
    try {
      res = await fetchJson<VideosResponse>(
        `${YOUTUBE_API}/videos?part=statistics&id=${batch.join(",")}&key=${encodeURIComponent(opts.apiKey)}`, http);
    } catch (error) {
      // Nunca se registra la URL con la clave.
      errors.push(`lote ${i / 50}: ${(error instanceof Error ? error.message : String(error)).replaceAll(opts.apiKey, "***").replaceAll(encodeURIComponent(opts.apiKey), "***")}`);
      continue;
    }
    const at = now();
    for (const item of res.items) {
      const views = Number(item.statistics?.viewCount);
      const filmId = byVideo.get(item.id);
      if (!filmId || !Number.isFinite(views)) continue; // estadísticas ocultas: sin dato, no se inventa
      const { rows: prev } = await db.query<{ payload: { views: number; at: string } }>(
        "select payload from source_records where source_id = 'youtube' and entity_type = 'film' and external_id = $1", [item.id]);
      await recordSource(db, {
        sourceId: "youtube", entityType: "film", externalId: item.id,
        sourceUrl: `https://www.youtube.com/watch?v=${item.id}`, payload: { views, at: at.toISOString() }, runId,
      });
      await db.query("update source_records set entity_id = $2 where source_id = 'youtube' and entity_type = 'film' and external_id = $1", [item.id, filmId]);
      const last = prev[0]?.payload;
      if (!last) continue; // primera observación: sólo línea base
      const hours = Math.max(1, Math.round((at.getTime() - Date.parse(last.at)) / HOUR));
      const delta = Math.max(0, views - last.views); // YouTube a veces corrige a la baja: no hay crecimiento negativo
      const bucketStart = new Date(Math.floor(Date.parse(last.at) / HOUR) * HOUR).toISOString();
      await db.query(
        `insert into trend_signals (film_id, source_id, metric, bucket_start, bucket_hours, value, evidence_url)
         values ($1, 'youtube', 'views_delta', $2, $3, $4, $5)
         on conflict (film_id, source_id, metric, bucket_start) do update set value = excluded.value, bucket_hours = excluded.bucket_hours, retrieved_at = now()`,
        [filmId, bucketStart, hours, delta, `https://www.youtube.com/watch?v=${item.id}`]);
      signals++;
    }
  }
  const batches = Math.ceil(ids.length / 50);
  const status: RunStatus = errors.length === 0 ? "succeeded" : errors.length < batches ? "partial" : "failed";
  await finishRun(db, runId, { status, seen: ids.length, upserted: signals, error: errors.join("\n") || null, meta: { quotaUnits: batches } });
  return { status, videos: ids.length, signals, quotaUnits: batches, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (conexión del rol de servicio).");
  const { db, end } = await openPostgres(url);
  console.log(JSON.stringify(await runYoutubeViews(db, { apiKey: process.env.YOUTUBE_API_KEY ?? "" }), null, 2));
  await end();
}
