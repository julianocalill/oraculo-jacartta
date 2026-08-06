-- Espalha os minutos dos crons para eliminar disparos simultâneos.
--
-- INCIDENTE 2026-08-05 16:30 UTC: todos os crons passaram a falhar com
-- `job startup timeout` e o app inteiro travou (login em 30-40s, home com
-- statement timeout, pool do PostgREST em available=-1 / waiting=10 /
-- 537 timeouts acumulados). Recuperado com restart do projeto às 18:42.
--
-- A causa não é volume, é CONCORRÊNCIA DE WORKER SLOTS. No compute Nano:
--   max_worker_processes = 6
-- e três slots já são permanentes (pg_cron launcher, logical replication
-- launcher, pg_net worker). Sobram 2-3 para jobs de cron E parallel workers
-- (max_parallel_workers = 2). Quando 4 jobs disparam no mesmo minuto, os que
-- não acham slot morrem em `job startup timeout` — o pg_cron não enfileira,
-- ele desiste.
--
-- O minuto :30 tinha exatamente 4 jobs (shopee-sync-donacor,
-- ml-notifications-10m, olist-invoices-15m, unified-sku-cache) — foi o
-- 16:30 que abriu o incidente. Os minutos :00, :15, :35 e :45 tinham 3.
--
-- Esta migration só muda `schedule`; nenhum comando é reescrito. O alvo é no
-- máximo 2 jobs por minuto, e só nos minutos :00/:30, onde restam
-- ml-notifications-10m + olist-invoices-15m (os dois mais leves).
--
-- Não mexe na frequência de nada: mesma vazão, horários diferentes. Se o
-- incidente voltar mesmo sem colisões, o próximo passo é o compute, não o
-- cron — 428 MB de RAM e 6 worker slots são pouco para 3 GB de dados.

do $$
declare
  ajuste record;
  alvo bigint;
begin
  for ajuste in
    select *
    from (values
      -- min :00/:15/:30/:45 (colidia com olist-invoices-15m nos quatro)
      ('shopee-sync-donacor',                          '1-59/15 * * * *'),
      -- min :30 (4 jobs) -> 28
      ('oraculo-unified-sku-cache',                    '28 * * * *'),
      -- min :35 (3 jobs) -> sobra só olist-orders-hourly
      ('oraculo-nf-cache-hourly',                      '34 * * * *'),
      ('mercadolivre-returns-hourly',                  '38 * * * *'),
      -- min :15 (3-4 jobs) -> sobra só olist-invoices-15m
      ('oraculo-fiscal-margin-snapshots-hourly',       '14 * * * *'),
      ('oraculo-olist-stock-6h',                       '26 */6 * * *'),
      -- min :45 (3 jobs) -> sobra só olist-invoices-15m
      ('oraculo-olist-invoices-monthly-headers-hourly','56 * * * *'),
      -- min :00 (3-4 jobs nas horas 0/6/12/18)
      ('oraculo-importacoes-ais-sync',                 '29 0,6,12,18 * * *'),
      -- pares de 2 que sobravam
      ('oraculo-olist-qty-cache',                      '23 * * * *'),
      ('shopee-sbs-hourly',                            '53 * * * *'),
      ('oraculo-olist-order-items-backfill-overnight', '57 3-8 * * *'),
      ('oraculo-mercadolivre-notifications-cleanup-weekly', '58 6 * * 0'),
      -- devoluções Shopee: saíam junto com os shopee-sync a cada 2h
      ('shopee-returns-jacartta',                      '4 */2 * * *'),
      ('shopee-returns-espaco-de-bicho',               '8 */2 * * *'),
      ('shopee-returns-donacor',                       '27 */2 * * *'),
      ('shopee-returns-oliverhome',                    '59 */2 * * *')
    ) as t(jobname, schedule)
  loop
    select jobid into alvo from cron.job where jobname = ajuste.jobname;

    if alvo is null then
      raise warning 'cron job % não existe; pulando', ajuste.jobname;
      continue;
    end if;

    perform cron.alter_job(alvo, schedule => ajuste.schedule);
    raise notice 'cron % -> %', ajuste.jobname, ajuste.schedule;
  end loop;
end $$;
