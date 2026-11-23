// Medición de cobertura de pósters por etapa: publicada → id de TMDB → enriquecida → poster en TMDB →
// film_images primaria → visible para anon (lo que sirve catalog). Sólo lectura.
import { inTransaction, type Db } from "../collectors/lib/db.ts";

export interface PosterCoverage {
  publicadas: number;
  con_tmdb_id: number;
  sin_tmdb_id: number;
  sin_tmdb_con_imdb: number;
  enriquecidas: number;
  con_id_sin_enriquecer: number;
  con_poster_en_tmdb: number;
  enriquecidas_sin_poster_en_tmdb: number;
  con_poster_primario: number;
  con_backdrop_primario: number;
  primarios_duplicados: number;
  visibles_anon: number;
  visibles_anon_con_poster: number;
  en_revision: number;
}

export async function posterCoverage(db: Db): Promise<PosterCoverage> {
  const { rows: [cov] } = await db.query<Record<string, number>>(`
    select
      count(*)::int                                                              as publicadas,
      count(*) filter (where t.film_id is not null)::int                         as con_tmdb_id,
      count(*) filter (where t.film_id is null)::int                             as sin_tmdb_id,
      count(*) filter (where t.film_id is null and i.film_id is not null)::int   as sin_tmdb_con_imdb,
      count(*) filter (where r.payload is not null)::int                         as enriquecidas,
      count(*) filter (where t.film_id is not null and r.payload is null)::int   as con_id_sin_enriquecer,
      count(*) filter (where jsonb_typeof(r.payload -> 'poster') = 'object')::int as con_poster_en_tmdb,
      count(*) filter (where r.payload is not null and jsonb_typeof(r.payload -> 'poster') is distinct from 'object')::int
                                                                                 as enriquecidas_sin_poster_en_tmdb,
      count(*) filter (where exists (select 1 from film_images x where x.film_id = f.id and x.kind = 'poster' and x.is_primary))::int
                                                                                 as con_poster_primario,
      count(*) filter (where exists (select 1 from film_images x where x.film_id = f.id and x.kind = 'backdrop' and x.is_primary))::int
                                                                                 as con_backdrop_primario
    from films f
    left join film_external_ids t on t.film_id = f.id and t.provider = 'tmdb'
    left join film_external_ids i on i.film_id = f.id and i.provider = 'imdb'
    left join lateral (select s.payload from source_records s
                       where s.source_id = 'tmdb' and s.entity_type = 'film' and s.entity_id = f.id
                       order by s.retrieved_at desc limit 1) r on true
    where f.published and f.merged_into is null`);
  const { rows: [dup] } = await db.query<{ n: number }>(`
    select count(*)::int as n from (select 1 from film_images where is_primary group by film_id, kind having count(*) > 1) x`);
  // match_reviews llega con la migración 20261124000000; antes de aplicarla la cola cuenta 0.
  const { rows: [has] } = await db.query<{ ok: boolean }>("select to_regclass('public.match_reviews') is not null as ok");
  const rev = has.ok
    ? (await db.query<{ n: number }>("select count(*)::int as n from match_reviews where status = 'pending'")).rows[0]
    : { n: 0 };
  const anon = await inTransaction(db, async () => {
    await db.query("set local role anon");
    const { rows: [r] } = await db.query<{ total: number; con_poster: number }>(`
      select count(*)::int as total,
             count(*) filter (where exists (select 1 from film_images i where i.film_id = f.id and i.kind = 'poster' and i.is_primary))::int as con_poster
      from films f`);
    return r;
  });
  return {
    ...(cov as unknown as PosterCoverage),
    primarios_duplicados: dup.n, visibles_anon: anon.total, visibles_anon_con_poster: anon.con_poster, en_revision: rev.n,
  };
}

export async function primaryPosterUrls(db: Db) {
  return (await db.query<{ title: string; url: string }>(`
    select f.title, i.url from film_images i join films f on f.id = i.film_id
    where i.kind = 'poster' and i.is_primary and f.published order by f.title`)).rows;
}

/** HEAD a cada URL con concurrencia limitada y reintentos ante 429/5xx/red. 0 = sin respuesta. */
export async function checkUrls(urls: { title: string; url: string }[], opts: { concurrency?: number; fetchImpl?: typeof fetch } = {}) {
  const { concurrency = 6, fetchImpl = fetch } = opts;
  const out: { title: string; url: string; status: number }[] = [];
  const queue = [...urls];
  const head = async (url: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
        if (res.status !== 429 && res.status < 500) return res.status;
      } catch { /* red: reintento */ }
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
    return 0;
  };
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let u = queue.shift(); u; u = queue.shift()) out.push({ ...u, status: await head(u.url) });
  }));
  return out;
}
