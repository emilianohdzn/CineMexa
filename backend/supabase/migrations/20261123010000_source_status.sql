-- Estado público de cada fuente para meta.sources del catálogo, sin exponer ingestion_runs.
-- status: ok (última corrida exitosa o parcial), failed, pending (habilitada sin corridas), not_configured.
create function public_source_status()
returns table (id text, name text, attribution text, last_sync_at timestamptz, status text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.attribution,
    (select max(r.finished_at) from ingestion_runs r where r.source_id = s.id and r.status in ('succeeded', 'partial')) as last_sync_at,
    case
      when not s.enabled then 'not_configured'
      else coalesce((
        select case r.status when 'failed' then 'failed' when 'running' then 'pending' else 'ok' end
        from ingestion_runs r where r.source_id = s.id order by r.started_at desc limit 1
      ), 'pending')
    end as status
  from sources s
  where s.id <> 'editorial'
  order by s.id;
$$;
revoke all on function public_source_status() from public;
grant execute on function public_source_status() to anon, authenticated, service_role;
