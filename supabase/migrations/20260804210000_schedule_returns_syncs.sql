-- Agenda os syncs de devolução. Rotina sem cron é falha invisível — a regra do
-- repositório é agendar na mesma migração que cria a função.
--
-- ⚠️ SHOPEE: POR LOJA, escalonado. Rodar as 4 lojas numa invocação estoura o
-- teto da edge function — medido: o backfill de julho com as 4 lojas morreu no
-- meio, sem log de execução, deixando a Donacor de fora e a Oliverhome parada
-- em 23/07. Silencioso, do jeito mais caro. É o mesmo motivo pelo qual
-- shopee-sync-products já é agendado por loja (20260716230000).

-- Helper de invocação do ML (o da Shopee já existe em 20260716230000).
create or replace function private.invoke_ml_function(
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
  select decrypted_secret into sync_secret from vault.decrypted_secrets where name = 'oraculo_mercadolivre_sync_job_secret' limit 1;
  if project_url is null or sync_secret is null then
    raise exception 'Missing Vault secrets: oraculo_project_url and/or oraculo_mercadolivre_sync_job_secret';
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
declare j record;
begin
  for j in select unnest(array[
    'shopee-returns-jacartta', 'shopee-returns-espaco-de-bicho',
    'shopee-returns-donacor', 'shopee-returns-oliverhome',
    'mercadolivre-returns-hourly'
  ]) as name loop
    begin perform cron.unschedule(j.name); exception when others then null; end;
  end loop;
end $$;

-- Janela de 3 dias por run: cobre atraso de sincronização sem repaginar o mês.
select cron.schedule('shopee-returns-jacartta', '12 */2 * * *',
  $$ select private.invoke_shopee_function('shopee-returns-sync?shop_id=279375549&days=3', 400000); $$);
select cron.schedule('shopee-returns-espaco-de-bicho', '24 */2 * * *',
  $$ select private.invoke_shopee_function('shopee-returns-sync?shop_id=823664460&days=3', 400000); $$);
select cron.schedule('shopee-returns-donacor', '36 */2 * * *',
  $$ select private.invoke_shopee_function('shopee-returns-sync?shop_id=1227023039&days=3', 400000); $$);
select cron.schedule('shopee-returns-oliverhome', '48 */2 * * *',
  $$ select private.invoke_shopee_function('shopee-returns-sync?shop_id=1540426526&days=3', 400000); $$);

-- ML: volume baixíssimo (~4/mês) e a API ignora filtro de data, então o custo
-- é varrer offsets. Uma vez por hora, em :35, longe do :55 do mercadolivre-sync
-- (que é o único renovador do token rotativo).
select cron.schedule('mercadolivre-returns-hourly', '35 * * * *',
  $$ select private.invoke_ml_function('mercadolivre-returns-sync?days=45', 300000); $$);
