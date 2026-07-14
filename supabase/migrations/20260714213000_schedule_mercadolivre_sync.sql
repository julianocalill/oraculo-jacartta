-- Agenda o sync horário do Mercado Livre (padrão dos jobs oraculo-olist-*).
-- Secret lido do Vault ('oraculo_mercadolivre_sync_job_secret'), nunca em texto plano.

create or replace function private.invoke_oraculo_mercadolivre_sync(
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
  where name = 'oraculo_mercadolivre_sync_job_secret'
  limit 1;

  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_mercadolivre_sync_job_secret';
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/mercadolivre-sync',
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
  perform cron.unschedule('oraculo-mercadolivre-sync-hourly');
exception
  when others then null;
end $$;

-- :55 para não competir com os jobs Olist (:5, :15, :25, :35, :45).
-- lookbackDays=2 cobre atrasos de fechamento de pedido; a carga de 30 dias
-- já foi feita manualmente na ativação.
select cron.schedule(
  'oraculo-mercadolivre-sync-hourly',
  '55 * * * *',
  $$
    select private.invoke_oraculo_mercadolivre_sync(
      '{"lookbackDays": 2}'::jsonb,
      300000
    );
  $$
);
