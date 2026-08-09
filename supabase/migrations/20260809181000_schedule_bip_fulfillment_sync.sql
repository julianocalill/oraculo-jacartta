-- Agenda o espelho de bipes a cada 2 minutos. O segredo do job fica no Vault;
-- URL e segredo da exportação do Bip ficam somente nas variáveis da Edge
-- Function bip-fulfillment-sync.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
create schema if not exists private;

create or replace function private.invoke_bip_fulfillment_sync(
  p_timeout_ms integer default 60000
)
returns bigint
language plpgsql
security invoker
as $$
declare
  project_url text;
  sync_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'oraculo_project_url'
  limit 1;

  select decrypted_secret into sync_secret
  from vault.decrypted_secrets
  where name = 'oraculo_shopee_sync_job_secret'
  limit 1;

  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_shopee_sync_job_secret';
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/bip-fulfillment-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', sync_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;

do $$
begin
  begin
    perform cron.unschedule('oraculo-bip-fulfillment-2m');
  exception when others then null;
  end;
end $$;

select cron.schedule(
  'oraculo-bip-fulfillment-2m',
  '*/2 * * * *',
  $$ select private.invoke_bip_fulfillment_sync(60000); $$
);
