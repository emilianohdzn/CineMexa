// Lee de Postgres lo publicable para el catálogo. Corre como rol `anon` dentro de una
// transacción, así que RLS decide qué se ve: lo no publicado, fusionado o 'unverified' no sale.
import { inTransaction, type Db } from "../collectors/lib/db.ts";

type Row = Record<string, any>;

export interface CatalogRows {
  films: Row[];
  credits: Row[];
  titles: Row[];
  externalIds: Row[];
  images: Row[];
  screenings: Row[];
  streaming: Row[];
  reviews: Row[];
  festivals: Row[];
  editions: Row[];
  events: Row[];
  news: Row[];
  trends: Row[];
  sources: Row[];
}

export interface LoadOptions {
  now: Date;
  /** Funciones desde hace N días (para "hoy") hasta dentro de M días. */
  screeningsPastDays?: number;
  screeningsAheadDays?: number;
  reviewsLimit?: number;
  newsLimit?: number;
  trendHistory?: number;
}

export async function loadCatalogRows(db: Db, opts: LoadOptions): Promise<CatalogRows> {
  const { now, screeningsPastDays = 1, screeningsAheadDays = 60, reviewsLimit = 300, newsLimit = 150, trendHistory = 30 } = opts;
  const at = now.toISOString();
  return inTransaction(db, async () => {
    await db.query("set local role anon");
    const q = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows;
    return {
      films: await q(`select id::text, slug, title, original_title, year, kind::text, runtime_minutes, countries, mx_participation::text,
          genres, is_documentary, is_animation, synopsis, trailer_url, mx_release_date::text, verification::text, updated_at
        from films order by year desc nulls last, title`),
      credits: await q(`select c.film_id::text, c.role::text, c.ord, p.name from film_credits c join people p on p.id = c.person_id
        order by c.film_id, c.role, c.ord, p.name`),
      titles: await q(`select film_id::text, title from film_titles order by film_id, title`),
      externalIds: await q(`select film_id::text, provider, external_id, is_canonical, source_id from film_external_ids`),
      images: await q(`select film_id::text, kind::text, url, width, height, source_id, attribution from film_images
        where is_primary and kind in ('poster', 'backdrop')`),
      screenings: await q(`select s.id::text, s.film_id::text, s.kind::text, s.starts_at, s.ticket_url, s.source_id, s.source_url,
          s.verification::text, s.retrieved_at, v.name as venue_name, v.city, v.country, v.latitude, v.longitude, v.coordinate_precision
        from screenings s join venues v on v.id = s.venue_id
        where not s.is_cancelled and s.starts_at between $1::timestamptz - make_interval(days => $2) and $1::timestamptz + make_interval(days => $3)
        order by s.starts_at`, [at, screeningsPastDays, screeningsAheadDays]),
      streaming: await q(`select film_id::text, provider, offer_type, url, source_id, retrieved_at from streaming_offers
        where country = 'MX' order by film_id, provider`),
      reviews: await q(`select id::text, film_id::text, outlet, critic_name, title, url, published_at, score, score_scale, excerpt,
          is_automated_summary, source_id, verification::text, retrieved_at
        from reviews where published_at <= $1 order by published_at desc limit $2`, [at, reviewsLimit]),
      festivals: await q(`select f.id::text, f.slug, f.name, f.short_name, f.city, f.country, f.website_url, f.focus, f.updated_at,
          v.name as venue_name, v.city as venue_city, v.country as venue_country, v.latitude, v.longitude, v.coordinate_precision
        from festivals f join venues v on v.id = f.default_venue_id order by f.name`),
      editions: await q(`select id::text, festival_id::text, edition_label, year, starts_on::text, ends_on::text, timezone, program_url,
          call_url, call_deadline, is_cancelled, source_id, source_url, verification::text, retrieved_at
        from festival_editions order by starts_on nulls last`),
      events: await q(`select e.id::text, e.edition_id::text, ed.festival_id::text, e.film_id::text, e.kind::text, e.section, e.award_name,
          e.occurs_at, e.announced_at, e.source_id, e.source_url, e.verification::text, e.confidence, e.retrieved_at
        from festival_events e join festival_editions ed on ed.id = e.edition_id where not e.is_cancelled
        order by coalesce(e.occurs_at, e.announced_at) desc nulls last`),
      news: await q(`select id::text, kind::text, title, url, outlet, published_at, film_id::text, festival_id::text, source_id,
          verification::text, retrieved_at
        from news_items where published_at <= $1 order by published_at desc limit $2`, [at, newsLimit]),
      trends: await q(`select window_key, computed_at, methodology_version, label, sources_used, entries from (
          select *, row_number() over (partition by window_key order by computed_at desc) as n from trend_snapshots
        ) t where n <= $1 order by window_key, computed_at desc`, [trendHistory]),
      sources: await q(`select * from public_source_status()`),
    };
  });
}
