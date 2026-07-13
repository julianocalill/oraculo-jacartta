-- Agenda o sync Shopee (edge function shopee-sync) por loja, escalonado.
-- Uma entrada por loja isola falhas e mantém cada invocação pequena (janela de
-- 20 min a cada 15 min = ~5 min de sobreposição de segurança). O disparo usa
-- pg_net + o segredo do vault (a função valida o header x-sync-secret).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
create schema if not exists private;

create or replace function private.invoke_shopee_sync(
  p_shop_id bigint,
  p_minutes integer default 20,
  p_timeout_ms integer default 120000
)
returns bigint
language plpgsql
security invoker
as $$
declare
  project_url text;
  sync_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'oraculo_project_url' limit 1;
  select decrypted_secret into sync_secret from vault.decrypted_secrets where name = 'oraculo_shopee_sync_job_secret' limit 1;
  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_shopee_sync_job_secret';
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/shopee-sync?shop_id=' || p_shop_id || '&minutes=' || p_minutes,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', sync_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;

-- (Re)agenda as 3 lojas prontas. Jacartta (279375549) fica fora até ter a
-- partner_key no shopee_app_config.
do $$
declare
  j record;
begin
  for j in
    select unnest(array[
      'shopee-sync-donacor', 'shopee-sync-espaco-de-bicho', 'shopee-sync-oliverhome'
    ]) as name
  loop
    begin
      perform cron.unschedule(j.name);
    exception when others then null;
    end;
  end loop;
end $$;

select cron.schedule('shopee-sync-donacor',       '0-59/15 * * * *', $$ select private.invoke_shopee_sync(1227023039, 20); $$);
select cron.schedule('shopee-sync-espaco-de-bicho','3-59/15 * * * *', $$ select private.invoke_shopee_sync(823664460, 20); $$);
select cron.schedule('shopee-sync-oliverhome',    '6-59/15 * * * *', $$ select private.invoke_shopee_sync(1540426526, 20); $$);
