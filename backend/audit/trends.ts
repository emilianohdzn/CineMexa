// Validación de tendencias: mediciones reales de YouTube, línea base, deltas, ventanas, duplicados y frescura.
import type { Db } from "../collectors/lib/db.ts";

export async function trendsHealth(db: Db) {
  const q = async <T,>(sql: string) => (await db.query<T>(sql)).rows;
  const [runs] = await q<{ corridas_ok: number; ultima: string | null; unidades_24h: number }>(`
    select count(*) filter (where status in ('succeeded', 'partial'))::int as corridas_ok,
           max(finished_at) filter (where status in ('succeeded', 'partial'))::text as ultima,
           coalesce(sum((meta ->> 'quotaUnits')::int) filter (where started_at > now() - interval '24 hours'), 0)::int as unidades_24h
    from ingestion_runs where source_id = 'youtube'`);
  const [videos] = await q<{ con_trailer: number; videos_medidos: number }>(`
    select (select count(*) from films where trailer_url is not null and published and merged_into is null)::int as con_trailer,
           (select count(*) from source_records where source_id = 'youtube' and entity_type = 'film')::int as videos_medidos`);
  const [signals] = await q<{ senales: number; peliculas: number; con_dos_o_mas: number; suma_delta: number; primera: string | null; ultima: string | null }>(`
    select count(*)::int as senales, count(distinct film_id)::int as peliculas,
           (select count(*) from (select film_id from trend_signals where source_id = 'youtube' group by film_id having count(*) >= 2) x)::int as con_dos_o_mas,
           coalesce(sum(value), 0)::float as suma_delta, min(bucket_start)::text as primera, max(bucket_start)::text as ultima
    from trend_signals where source_id = 'youtube'`);
  // Un mismo video asignado a varias películas, o una película con dos tráilers distintos medidos.
  const duplicados = await q<{ trailer_url: string; peliculas: number }>(`
    select trailer_url, count(*)::int as peliculas from films where trailer_url is not null and published
    group by trailer_url having count(*) > 1`);
  const negativos = await q<{ n: number }>("select count(*)::int as n from trend_signals where value < 0");
  const ventanas = await q<{ window_key: string; computed_at: string; entries: number; sources_used: string[] }>(`
    select distinct on (window_key) window_key, computed_at::text, jsonb_array_length(entries)::int as entries, sources_used
    from trend_snapshots order by window_key, computed_at desc`);
  return {
    youtube: { ...runs, ...videos },
    senales: { ...signals, negativos: negativos[0].n },
    duplicados,
    ventanas,
    suficiente_para_ranking: signals.con_dos_o_mas > 0,
  };
}
