-- Agenda o processamento da inbox de notificações do Mercado Livre.
-- Helper genérico para funções ML (o invoke_oraculo_mercadolivre_sync
-- existente permanece para o job horário já ativo).

create or replace function private.invoke_oraculo_mercadolivre_function(
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
  where name = 'oraculo_mercadolivre_sync_job_secret'
  limit 1;

  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_mercadolivre_sync_job_secret';
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
  perform cron.unschedule('oraculo-mercadolivre-notifications-10m');
exception
  when others then null;
end $$;

-- Minutos 0/10/20/30/40/50: livres (Olist usa :5/:15/:25/:35/:45; ML sync usa :55).
select cron.schedule(
  'oraculo-mercadolivre-notifications-10m',
  '*/10 * * * *',
  $$
    select private.invoke_oraculo_mercadolivre_function(
      'mercadolivre-process-notifications',
      '{}'::jsonb,
      120000
    );
  $$
);
