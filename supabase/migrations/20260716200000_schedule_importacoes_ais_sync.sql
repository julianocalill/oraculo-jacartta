-- Agenda o sync de posições AIS das importações (Edge Function
-- importacoes-ais-sync, VesselAPI). Padrão dos jobs oraculo-*: secret no
-- Vault ('oraculo_importacoes_ais_job_secret'), nunca em texto plano.

-- Log de execuções (lido pela página /status)
create table if not exists public.importacao_ais_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null,
  vessels_targeted integer not null default 0,
  positions_updated integer not null default 0,
  positions_skipped integer not null default 0,
  error_message text
);

create index if not exists importacao_ais_sync_runs_started_idx
  on public.importacao_ais_sync_runs (started_at desc);

alter table public.importacao_ais_sync_runs enable row level security;

revoke all on table public.importacao_ais_sync_runs from public, anon, authenticated;
grant all on table public.importacao_ais_sync_runs to service_role;
grant select on table public.importacao_ais_sync_runs to authenticated;

create policy importacao_ais_sync_runs_authenticated_read
  on public.importacao_ais_sync_runs for select to authenticated using (true);

-- Invocador com secrets do Vault
create or replace function private.invoke_oraculo_importacoes_ais_sync(
  payload jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 120000
)
returns bigint
language plpgsql
security invoker
as $$
declare
  project_url text;
  sync_secret text;
begin
  select decrypted_secret
    into project_url
  from vault.decrypted_secrets
  where name = 'oraculo_project_url'
  limit 1;

  select decrypted_secret
    into sync_secret
  from vault.decrypted_secrets
  where name = 'oraculo_importacoes_ais_job_secret'
  limit 1;

  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_importacoes_ais_job_secret';
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/importacoes-ais-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', sync_secret
    ),
    body := payload,
    timeout_milliseconds := timeout_milliseconds
  );
end;
$$;

do $$
begin
  perform cron.unschedule('oraculo-importacoes-ais-sync');
exception
  when others then null;
end $$;

-- A cada 6 horas (03:00/09:00/15:00/21:00 em São Paulo). Poucos navios por
-- rodada (só os citados em faturas), então o consumo da VesselAPI é mínimo.
select cron.schedule(
  'oraculo-importacoes-ais-sync',
  '0 0,6,12,18 * * *',
  $$
    select private.invoke_oraculo_importacoes_ais_sync('{}'::jsonb, 120000);
  $$
);
