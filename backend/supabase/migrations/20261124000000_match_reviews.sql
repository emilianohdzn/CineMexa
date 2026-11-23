-- Cola de revisión de coincidencias entre registros locales y fuentes externas (TMDB, crítica, noticias).
-- Una coincidencia ambigua nunca se aplica sola: queda 'pending' hasta que alguien del equipo la decide.
-- 'auto_matched' deja rastro de las vinculaciones automáticas (identificador confiable o título+año+dirección);
-- 'no_match' evita volver a buscar en cada corrida (se reintenta cuando caduca, ver los collectors).
create table match_reviews (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null check (entity_type in ('film', 'review', 'news_item', 'festival_event')),
  entity_id       uuid,
  provider        text not null,
  candidate_id    text,
  candidate_label text,
  method          text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'rejected', 'auto_matched', 'no_match', 'obsolete')),
  score           numeric(4, 3),
  evidence        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid,
  unique nulls not distinct (entity_type, entity_id, provider, candidate_id)
);
create index match_reviews_pending_idx on match_reviews (entity_type, provider) where status = 'pending';

alter table match_reviews enable row level security;
-- Sin política pública: sólo service_role (collectors) y, más adelante, el panel de staff.
create policy staff_all on match_reviews for all
  using (exists (select 1 from staff s where s.user_id = auth.uid()))
  with check (exists (select 1 from staff s where s.user_id = auth.uid()));
