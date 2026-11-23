-- Cine Mexa · esquema inicial
-- Todas las marcas de tiempo en UTC (timestamptz). Las fechas de edición de festival
-- son fechas de calendario locales del festival (date) + zona horaria IANA.
-- Lectura pública sólo de datos publicables; escritura sólo vía service_role (collectors)
-- o editores autenticados con rol en public.staff.

create extension if not exists pg_trgm;

-- ───────────────────────── Tipos ─────────────────────────
create type verification_status as enum ('verified', 'editorial', 'automatic', 'unverified');
create type film_kind as enum ('feature', 'short');
create type mx_participation as enum ('majority', 'coproduction', 'minority', 'unknown');
create type image_kind as enum ('poster', 'backdrop', 'still', 'logo');
create type credit_role as enum ('director', 'writer', 'cinematographer', 'cast', 'producer', 'editor', 'composer');
create type festival_event_kind as enum ('selection', 'screening', 'award', 'premiere');
create type screening_kind as enum ('commercial', 'cineteca', 'cineclub', 'festival');
create type news_kind as enum ('selection', 'award', 'premiere', 'call', 'publication', 'industry');
create type ingestion_status as enum ('running', 'succeeded', 'partial', 'failed');
create type staff_role as enum ('editor', 'admin');

-- ───────────────────────── Fuentes y procedencia ─────────────────────────
create table sources (
  id            text primary key,                 -- 'wikidata', 'tmdb', 'youtube', 'editorial', 'ficm-rss'…
  name          text not null,
  kind          text not null check (kind in ('api', 'feed', 'editorial', 'partner')),
  homepage_url  text,
  terms_url     text,
  attribution   text,                             -- texto de atribución obligatorio
  license       text,
  enabled       boolean not null default false,
  requires_credentials boolean not null default false,
  sync_interval interval,                         -- frecuencia objetivo configurable
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table ingestion_runs (
  id            uuid primary key default gen_random_uuid(),
  source_id     text not null references sources(id),
  job           text not null,                    -- 'discover_films', 'festival_program'…
  status        ingestion_status not null default 'running',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  records_seen  integer not null default 0,
  records_upserted integer not null default 0,
  error         text,
  meta          jsonb not null default '{}'
);
create index ingestion_runs_source_started_idx on ingestion_runs (source_id, started_at desc);

-- Registro crudo por fuente: lo que dijo la fuente, cuándo, y a qué entidad se resolvió.
create table source_records (
  id            uuid primary key default gen_random_uuid(),
  source_id     text not null references sources(id),
  external_id   text not null,
  entity_type   text not null check (entity_type in ('film', 'person', 'festival', 'festival_edition', 'festival_event', 'screening', 'review', 'news_item', 'venue')),
  entity_id     uuid,
  source_url    text,
  payload       jsonb not null,
  payload_hash  text not null,                    -- detecta cambios entre consultas
  published_at  timestamptz,
  retrieved_at  timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  last_run_id   uuid references ingestion_runs(id) on delete set null,
  unique (source_id, entity_type, external_id)
);
create index source_records_entity_idx on source_records (entity_type, entity_id);

-- Columnas de procedencia que comparten las tablas de hechos.
-- (Se repiten explícitamente para mantener FKs y consultas simples.)

-- ───────────────────────── Películas ─────────────────────────
create function all_iso_countries(text[]) returns boolean language sql immutable as $$
  select coalesce(bool_and(c ~ '^[A-Z]{2}$'), true) from unnest($1) as c;
$$;

create table films (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title           text not null,
  original_title  text,
  year            smallint check (year between 1895 and 2100),
  kind            film_kind not null default 'feature',
  runtime_minutes smallint check (runtime_minutes > 0),
  countries       text[] not null default '{}' check (all_iso_countries(countries)), -- ISO alpha-2
  mx_participation mx_participation not null default 'unknown',
  is_documentary  boolean not null default false,
  is_animation    boolean not null default false,
  genres          text[] not null default '{}',
  synopsis        text,
  synopsis_source_id text references sources(id),
  trailer_url     text,
  mx_release_date date,                           -- estreno identificado (no implica funciones)
  verification    verification_status not null default 'automatic',
  needs_review    boolean not null default false,
  merged_into     uuid references films(id),      -- duplicado resuelto
  published       boolean not null default false, -- visible en la API pública
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (merged_into is null or merged_into <> id)
);
create index films_title_trgm_idx on films using gin (title gin_trgm_ops);
create index films_year_idx on films (year);
create index films_kind_idx on films (kind) where published;

create table film_titles (
  film_id   uuid not null references films(id) on delete cascade,
  title     text not null,
  language  text,
  country   text,
  source_id text references sources(id),
  primary key (film_id, title)
);

create table film_external_ids (
  film_id     uuid not null references films(id) on delete cascade,
  provider    text not null check (provider in ('wikidata', 'tmdb', 'imdb', 'imcine', 'filmaffinity')),
  external_id text not null,
  is_canonical boolean not null default false,
  source_id   text references sources(id),
  created_at  timestamptz not null default now(),
  primary key (film_id, provider),
  unique (provider, external_id)                  -- un id externo apunta a una sola película
);
create unique index film_external_ids_one_canonical on film_external_ids (film_id) where is_canonical;

create table film_images (
  id          uuid primary key default gen_random_uuid(),
  film_id     uuid not null references films(id) on delete cascade,
  kind        image_kind not null,
  url         text not null,
  width       integer check (width > 0),
  height      integer check (height > 0),
  language    text,
  source_id   text not null references sources(id),
  source_url  text,
  attribution text,
  is_official boolean not null default false,     -- póster oficial autorizado
  is_primary  boolean not null default false,
  retrieved_at timestamptz not null default now(),
  unique (film_id, kind, url)
);
create unique index film_images_one_primary on film_images (film_id, kind) where is_primary;

create table people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_key    text not null,                      -- normalizePersonName()
  wikidata_id text unique check (wikidata_id ~ '^Q[1-9][0-9]*$'),
  tmdb_id     integer unique,
  created_at  timestamptz not null default now()
);
create index people_name_key_idx on people (name_key);

create table film_credits (
  film_id   uuid not null references films(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role      credit_role not null,
  character text,
  ord       smallint not null default 0,
  source_id text references sources(id),
  primary key (film_id, person_id, role)
);
create index film_credits_person_idx on film_credits (person_id);

-- ───────────────────────── Festivales ─────────────────────────
create table venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  city        text not null,
  country     text not null check (country ~ '^[A-Z]{2}$'),
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  coordinate_precision text not null default 'venue' check (coordinate_precision in ('venue', 'city')),
  coordinate_source_id text references sources(id),
  verification verification_status not null default 'editorial',
  kind        text check (kind in ('festival', 'cinema', 'cineteca', 'cineclub', 'other')),
  created_at  timestamptz not null default now(),
  unique (name, city, country)
);

create table festivals (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null,
  short_name  text,
  city        text not null,
  country     text not null check (country ~ '^[A-Z]{2}$'),
  website_url text,
  wikidata_id text unique,
  focus       text[] not null default '{}',       -- 'shorts', 'documentary', 'animation'…
  default_venue_id uuid references venues(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table festival_editions (
  id           uuid primary key default gen_random_uuid(),
  festival_id  uuid not null references festivals(id) on delete cascade,
  edition_label text not null,                    -- '24ª edición', '2027'
  year         smallint not null,
  starts_on    date,                              -- null = no confirmada
  ends_on      date,
  timezone     text not null default 'America/Mexico_City',
  program_url  text,
  call_url     text,
  call_opens_on date,
  call_deadline timestamptz,                      -- deadline exacto con hora UTC
  is_cancelled boolean not null default false,
  source_id    text not null references sources(id),
  source_url   text,
  verification verification_status not null default 'automatic',
  retrieved_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (festival_id, year, edition_label),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index festival_editions_dates_idx on festival_editions (starts_on, ends_on);
create index festival_editions_deadline_idx on festival_editions (call_deadline) where call_deadline is not null;

-- Participación de una película en una edición: selección, función, premio o estreno.
create table festival_events (
  id           uuid primary key default gen_random_uuid(),
  edition_id   uuid not null references festival_editions(id) on delete cascade,
  film_id      uuid not null references films(id) on delete cascade,
  kind         festival_event_kind not null,
  section      text,
  award_name   text,
  venue_id     uuid references venues(id),
  occurs_at    timestamptz,                       -- null = sin fecha confirmada
  announced_at timestamptz,
  is_cancelled boolean not null default false,
  source_id    text not null references sources(id),
  source_url   text,
  verification verification_status not null default 'automatic',
  confidence   real check (confidence between 0 and 1),
  retrieved_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (kind <> 'award' or award_name is not null)
);
create index festival_events_film_idx on festival_events (film_id);
create index festival_events_edition_idx on festival_events (edition_id, kind);
create unique index festival_events_dedupe on festival_events (edition_id, film_id, kind, coalesce(section, ''), coalesce(award_name, ''), coalesce(occurs_at, 'epoch'::timestamptz));

-- ───────────────────────── Exhibición ─────────────────────────
create table screenings (
  id          uuid primary key default gen_random_uuid(),
  film_id     uuid not null references films(id) on delete cascade,
  venue_id    uuid not null references venues(id),
  kind        screening_kind not null,
  starts_at   timestamptz not null,
  ticket_url  text,
  language    text,
  is_cancelled boolean not null default false,
  source_id   text not null references sources(id),
  source_url  text,
  verification verification_status not null default 'automatic',
  retrieved_at timestamptz not null default now(),
  unique (film_id, venue_id, starts_at)
);
create index screenings_starts_idx on screenings (starts_at) where not is_cancelled;

create table streaming_offers (
  id          uuid primary key default gen_random_uuid(),
  film_id     uuid not null references films(id) on delete cascade,
  provider    text not null,
  offer_type  text not null check (offer_type in ('subscription', 'rent', 'buy', 'free', 'ads')),
  country     text not null default 'MX',
  url         text,
  source_id   text not null references sources(id),
  retrieved_at timestamptz not null default now(),
  unique (film_id, provider, offer_type, country)
);

-- ───────────────────────── Crítica ─────────────────────────
create table reviews (
  id           uuid primary key default gen_random_uuid(),
  film_id      uuid not null references films(id) on delete cascade,
  outlet       text not null,
  critic_name  text,
  title        text not null,
  url          text not null unique,
  language     text not null default 'es',
  published_at timestamptz not null,
  score        numeric(4,2),                      -- sólo con licencia
  score_scale  numeric(4,2),
  score_licensed boolean not null default false,
  excerpt      text,                              -- sólo con permiso
  excerpt_licensed boolean not null default false,
  is_automated_summary boolean not null default false,
  partner_id   text references sources(id),       -- alianza editorial
  source_id    text not null references sources(id),
  verification verification_status not null default 'automatic',
  retrieved_at timestamptz not null default now(),
  check (score is null or score_licensed),
  check (excerpt is null or excerpt_licensed),
  check (score is null or (score_scale is not null and score <= score_scale))
);
create index reviews_film_published_idx on reviews (film_id, published_at desc);
create index reviews_published_idx on reviews (published_at desc);

-- ───────────────────────── Tendencias ─────────────────────────
create table trend_signals (
  id          bigint generated always as identity primary key,
  film_id     uuid not null references films(id) on delete cascade,
  source_id   text not null references sources(id),
  metric      text not null,
  bucket_start timestamptz not null,              -- inicio del intervalo agregado
  bucket_hours smallint not null default 1 check (bucket_hours > 0),
  value       double precision not null check (value >= 0),
  evidence_url text,
  retrieved_at timestamptz not null default now(),
  unique (film_id, source_id, metric, bucket_start)
);
create index trend_signals_bucket_idx on trend_signals (bucket_start);

create table trend_snapshots (
  id          uuid primary key default gen_random_uuid(),
  window_key  text not null check (window_key in ('24h', '7d', '30d')),
  computed_at timestamptz not null default now(),
  methodology_version text not null,
  label       text not null,
  sources_used text[] not null,
  entries     jsonb not null,                     -- TrendEntry[] (packages/core)
  unique (window_key, computed_at)
);

-- ───────────────────────── Noticias ─────────────────────────
create table news_items (
  id          uuid primary key default gen_random_uuid(),
  kind        news_kind not null,
  title       text not null,
  url         text not null unique,
  outlet      text,
  published_at timestamptz not null,
  film_id     uuid references films(id) on delete set null,
  festival_id uuid references festivals(id) on delete set null,
  source_id   text not null references sources(id),
  verification verification_status not null default 'automatic',
  retrieved_at timestamptz not null default now()
);
create index news_items_published_idx on news_items (published_at desc);

-- ───────────────────────── Usuarios (opcional, Supabase Auth) ─────────────────────────
create table staff (
  user_id uuid primary key,                       -- auth.users.id
  role    staff_role not null default 'editor',
  created_at timestamptz not null default now()
);

create table user_favorites (
  user_id     uuid not null,                      -- auth.users.id
  entity_type text not null check (entity_type in ('film', 'festival')),
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

create table user_alerts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  kind        text not null check (kind in ('release', 'selection', 'festival_reminder', 'deadline', 'film_updates')),
  entity_type text not null check (entity_type in ('film', 'festival', 'festival_edition')),
  entity_id   uuid not null,
  remind_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, entity_type, entity_id)
);

-- ───────────────────────── updated_at ─────────────────────────
create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger films_touch before update on films for each row execute function touch_updated_at();
create trigger festivals_touch before update on festivals for each row execute function touch_updated_at();
create trigger editions_touch before update on festival_editions for each row execute function touch_updated_at();
create trigger events_touch before update on festival_events for each row execute function touch_updated_at();
create trigger sources_touch before update on sources for each row execute function touch_updated_at();

-- ───────────────────────── Seguridad (RLS) ─────────────────────────
create function is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['sources','ingestion_runs','source_records','films','film_titles','film_external_ids',
    'film_images','people','film_credits','venues','festivals','festival_editions','festival_events',
    'screenings','streaming_offers','reviews','trend_signals','trend_snapshots','news_items','staff',
    'user_favorites','user_alerts']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Lectura pública (anon + authenticated) de datos publicables. service_role ignora RLS.
create policy public_read on films for select using (published and merged_into is null and verification <> 'unverified');
create policy public_read on film_titles for select using (exists (select 1 from films f where f.id = film_id and f.published));
create policy public_read on film_external_ids for select using (exists (select 1 from films f where f.id = film_id and f.published));
create policy public_read on film_images for select using (exists (select 1 from films f where f.id = film_id and f.published));
create policy public_read on people for select using (true);
create policy public_read on film_credits for select using (exists (select 1 from films f where f.id = film_id and f.published));
create policy public_read on venues for select using (true);
create policy public_read on festivals for select using (true);
create policy public_read on festival_editions for select using (verification <> 'unverified');
create policy public_read on festival_events for select using (verification <> 'unverified');
create policy public_read on screenings for select using (verification <> 'unverified');
create policy public_read on streaming_offers for select using (true);
create policy public_read on reviews for select using (verification <> 'unverified');
create policy public_read on trend_snapshots for select using (true);
create policy public_read on news_items for select using (verification <> 'unverified');
create policy public_read on sources for select using (enabled);
-- ingestion_runs, source_records y trend_signals: sólo staff.

-- Staff: lectura y edición de curaduría.
do $$
declare t text;
begin
  foreach t in array array['sources','ingestion_runs','source_records','films','film_titles','film_external_ids',
    'film_images','people','film_credits','venues','festivals','festival_editions','festival_events',
    'screenings','streaming_offers','reviews','trend_signals','trend_snapshots','news_items']
  loop
    execute format('create policy staff_all on %I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;
create policy staff_self_read on staff for select to authenticated using (user_id = auth.uid());

-- Favoritos y alertas: cada usuario sólo ve y modifica los suyos.
create policy own_rows on user_favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on user_alerts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on staff from anon;
revoke all on user_favorites, user_alerts from anon;

-- ───────────────────────── Fuentes iniciales ─────────────────────────
insert into sources (id, name, kind, homepage_url, terms_url, attribution, license, enabled, requires_credentials, sync_interval) values
  ('wikidata', 'Wikidata', 'api', 'https://www.wikidata.org', 'https://www.wikidata.org/wiki/Wikidata:Licensing', 'Datos de Wikidata (CC0)', 'CC0-1.0', true, false, '24 hours'),
  ('tmdb', 'The Movie Database (TMDB)', 'api', 'https://www.themoviedb.org', 'https://www.themoviedb.org/api-terms-of-use', 'This product uses the TMDB API but is not endorsed or certified by TMDB.', 'TMDB API Terms', false, true, '24 hours'),
  ('youtube', 'YouTube Data API', 'api', 'https://developers.google.com/youtube/v3', 'https://developers.google.com/youtube/terms/api-services-terms-of-service', 'Datos de YouTube', 'YouTube API Services ToS', false, true, '6 hours'),
  ('google_trends', 'Google Trends API', 'api', 'https://trends.google.com', null, 'Datos de Google Trends', 'Acceso aprobado requerido', false, true, '6 hours'),
  ('editorial', 'Equipo editorial Cine Mexa', 'editorial', null, null, 'Curaduría Cine Mexa', null, true, false, null);
