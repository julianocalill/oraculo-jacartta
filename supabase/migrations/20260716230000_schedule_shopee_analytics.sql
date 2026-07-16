-- Agenda os syncs analíticos Shopee (SBS/FBS e produtos), padrão pg_net +
-- vault ('oraculo_shopee_sync_job_secret', o mesmo do shopee-sync).

create or replace function private.invoke_shopee_function(
  p_function text,
  p_timeout_ms integer default 300000
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
    url := project_url || '/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', sync_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;

do $$
declare
  j record;
begin
  for j in select unnest(array[
    'shopee-sbs-hourly', 'shopee-products-6h',
    'shopee-products-jacartta', 'shopee-products-espaco-de-bicho',
    'shopee-products-donacor', 'shopee-products-oliverhome'
  ]) as name loop
    begin
      perform cron.unschedule(j.name);
    exception when others then null;
    end;
  end loop;
end $$;

-- SBS é leve (hoje só a Oliverhome tem estoque FBS): horário, minuto :42,
-- todas as lojas numa invocação.
select cron.schedule(
  'shopee-sbs-hourly',
  '42 * * * *',
  $$ select private.invoke_shopee_function('shopee-sync-sbs', 180000); $$
);

-- Produtos: catálogos grandes estouram o teto da edge function quando as 4
-- lojas rodam numa invocação — agenda POR LOJA, escalonado, a cada 6h.
select cron.schedule('shopee-products-jacartta',        '22 1,7,13,19 * * *',
  $$ select private.invoke_shopee_function('shopee-sync-products?shop_id=279375549', 300000); $$);
select cron.schedule('shopee-products-espaco-de-bicho', '32 1,7,13,19 * * *',
  $$ select private.invoke_shopee_function('shopee-sync-products?shop_id=823664460', 300000); $$);
select cron.schedule('shopee-products-donacor',         '44 1,7,13,19 * * *',
  $$ select private.invoke_shopee_function('shopee-sync-products?shop_id=1227023039', 300000); $$);
select cron.schedule('shopee-products-oliverhome',      '52 1,7,13,19 * * *',
  $$ select private.invoke_shopee_function('shopee-sync-products?shop_id=1540426526', 300000); $$);
