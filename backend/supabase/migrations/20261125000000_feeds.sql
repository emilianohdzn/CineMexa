-- Crítica y noticias desde feeds (RSS/Atom) de medios con permiso o feed público de sindicación.
-- Sólo metadatos: título, autor, medio, fecha y enlace. Nunca el texto completo ni calificaciones sin licencia.
-- Cada medio es una fila de `sources` con kind = 'feed'; se activa a mano (enabled) tras revisar sus términos.
alter table sources
  add column if not exists feed_url   text check (feed_url is null or feed_url ~ '^https://'),
  add column if not exists feed_kind  text check (feed_kind is null or feed_kind in ('reviews', 'news', 'mixed')),
  -- 'mx': medio dedicado al cine mexicano (una noticia sin película identificada se conserva);
  -- 'general': sólo se conserva lo que menciona una película del catálogo.
  add column if not exists feed_scope text check (feed_scope is null or feed_scope in ('mx', 'general'));

alter table news_items add column if not exists author text;

-- Los artículos crudos del feed viven en source_records como 'feed_item' y la cola de revisión los referencia.
alter table source_records drop constraint if exists source_records_entity_type_check;
alter table source_records add constraint source_records_entity_type_check check (entity_type in
  ('film', 'person', 'festival', 'festival_edition', 'festival_event', 'screening', 'review', 'news_item', 'venue', 'feed_item'));
alter table match_reviews drop constraint if exists match_reviews_entity_type_check;
alter table match_reviews add constraint match_reviews_entity_type_check check (entity_type in
  ('film', 'review', 'news_item', 'festival_event', 'feed_item'));
