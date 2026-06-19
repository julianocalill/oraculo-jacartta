create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

create schema if not exists private;

create or replace function private.invoke_oraculo_sync_function(
  function_name text,
  payload jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 300000
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
  where name = 'oraculo_olist_sync_job_secret'
  limit 1;

  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_olist_sync_job_secret';
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/' || function_name,
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
  perform cron.unschedule('oraculo-olist-orders-0600');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-stock-0610');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-derived-0640');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-orders-0600',
  '0 9 * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-orders',
      '{"lookbackDays": 7, "maxPages": 200, "hydrateDetails": true}'::jsonb,
      300000
    );
  $$
);

select cron.schedule(
  'oraculo-olist-stock-0610',
  '10 9 * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-stock',
      '{}'::jsonb,
      300000
    );
  $$
);

select cron.schedule(
  'oraculo-olist-derived-0640',
  '40 9 * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-derived-refresh',
      '{"monthsBack": 1}'::jsonb,
      300000
    );
  $$
);
