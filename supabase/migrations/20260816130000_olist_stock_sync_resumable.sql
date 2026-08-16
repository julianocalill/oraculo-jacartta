-- Torna o sync de estoque da Olist retomável por cursor.
--
-- INCIDENTE (detectado 2026-08-16): olist_products e a cauda de
-- olist_stock_items congeladas desde 16-21/06. Duas causas, ambas da
-- migration 20260621223906:
--
-- 1. `oraculo-olist-stock-6h` pedia a varredura completa (maxPages 1000 =
--    ~2.888 produtos = ~29 min) em uma única invocação, mas a Edge Function
--    é morta por wall-clock em ~190s. Cada run reprocessava as mesmas ~300
--    primeiras linhas e morria: nenhum registro em olist_stock_sync_runs
--    desde 19/06, e 2.578 itens presos em active=false (marcados stale por
--    um run parcial que completou em 19/06 com maxPages baixo).
--
-- 2. O job diário `oraculo-olist-derived-0640` (modo full, que alimentava
--    olist_products e olist_stock_snapshots a partir de olist_stock_items)
--    foi desagendado e o horário virou incremental com
--    includeProductDimensions=false. Nada mais escrevia em olist_products.
--
-- Correção: estado de varredura persistido em olist_stock_sync_state; a
-- função processa poucas páginas por invocação (pagesPerRun; o gateway corta
-- a resposta em 150s de idle, então 1 página ≈ 70s por run) e retoma do
-- cursor. O cron passa a rodar a cada 30 min nos minutos :11/:41 (livres de
-- colisão; teto de 2 jobs/minuto — ver 20260805190000; o bip-fulfillment-2m
-- ocupa só minutos pares). Varredura completa fecha em ~14,5h.
-- Um job diário refaz produtos + snapshot de estoque.

create table if not exists public.olist_stock_sync_state (
  id smallint primary key default 1 check (id = 1),
  batch_id uuid,
  next_offset integer not null default 0,
  total integer,
  sweep_started_at timestamptz,
  records_fetched integer not null default 0,
  records_upserted integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.olist_stock_sync_state enable row level security;

do $$
begin
  perform cron.unschedule('oraculo-olist-stock-6h');
exception
  when others then null;
end $$;

do $$
begin
  perform cron.unschedule('oraculo-olist-stock-30m');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-stock-30m',
  '11,41 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-stock',
      '{"pagesPerRun": 1, "detailConcurrency": 1, "detailDelayMs": 300}'::jsonb,
      300000
    );
  $$
);

-- Refaz o cadastro (olist_products) e o snapshot diário de estoque a partir
-- de olist_stock_items — o que o antigo derived-0640 fazia. Caches de venda,
-- NF e SKU unificado ficam de fora: já têm crons próprios.
do $$
begin
  perform cron.unschedule('oraculo-olist-products-daily');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-products-daily',
  '43 7 * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-derived-refresh',
      jsonb_build_object(
        'startDate', ((current_date - interval '2 days')::date)::text,
        'endDate', ((current_date + interval '1 day')::date)::text,
        'includeOrderItems', false,
        'includeDimensions', true,
        'includeProductDimensions', true,
        'includeStockSnapshot', true,
        'includeSalesCaches', false,
        'includeNfCache', false,
        'includeUnifiedChannelCache', false,
        'includeUnifiedSkuCache', false
      ),
      300000
    );
  $$
);
