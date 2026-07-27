-- O fix de índices (20260721140000) não bastou: o projeto roda no compute Nano
-- do Supabase (0,5 vCPU compartilhada, burst). Quando os créditos de CPU acabam
-- — e os syncs de 15 em 15 minutos ajudam a drená-los — o mesmo plano que roda
-- em 0,5s passa a levar 5-30s (medido: index-only scan 100% em cache a ~25MB/s)
-- e a aba /shopee volta a estourar o statement_timeout.
--
-- Solução no padrão que o projeto já usa para NF (oraculo_nf_daily_cache):
-- tabelas de cache + função de refresh + pg_cron. A agregação pesada roda a
-- cada 30 min; a página lê a tabela pronta (~3 mil linhas) em milissegundos,
-- com ou sem CPU disponível. As views originais continuam como fonte.

create table if not exists public.oraculo_shopee_take_rate_shop_daily_cache (
  order_date date not null,
  shop_id bigint not null,
  shop_name text not null,
  orders_count bigint,
  gross_amount numeric,
  commission_fee numeric,
  service_fee numeric,
  transaction_fee numeric,
  total_fees numeric,
  voucher_from_shopee numeric,
  voucher_from_seller numeric,
  net_amount numeric,
  take_rate_pct numeric,
  refreshed_at timestamptz not null default now(),
  primary key (order_date, shop_id)
);

create table if not exists public.oraculo_shopee_take_rate_sku_daily_cache (
  order_date date not null,
  shop_id bigint not null,
  shop_name text not null,
  sku text,
  product_name text,
  orders_count bigint,
  units numeric,
  gross_amount numeric,
  fees_allocated numeric,
  net_amount numeric,
  take_rate_pct numeric,
  unit_cost numeric,
  cost_total numeric,
  net_profit numeric,
  roi_pct numeric,
  refreshed_at timestamptz not null default now()
);

create index if not exists shopee_take_rate_sku_cache_date_idx
  on public.oraculo_shopee_take_rate_sku_daily_cache (order_date, shop_id);

-- Mesmo modelo de acesso da tabela de escrow: só service_role lê (a página usa
-- o admin client).
alter table public.oraculo_shopee_take_rate_shop_daily_cache enable row level security;
alter table public.oraculo_shopee_take_rate_sku_daily_cache enable row level security;
revoke all on table public.oraculo_shopee_take_rate_shop_daily_cache from public, anon, authenticated;
revoke all on table public.oraculo_shopee_take_rate_sku_daily_cache from public, anon, authenticated;
grant all on table public.oraculo_shopee_take_rate_shop_daily_cache to service_role;
grant all on table public.oraculo_shopee_take_rate_sku_daily_cache to service_role;

-- Rebuild completo: o escrow só tem dados desde 2026-07-01 (~3 mil linhas
-- agregadas), não compensa refresh incremental. Delete + insert na mesma
-- transação — leitores nunca veem a tabela vazia (MVCC).
create or replace function public.refresh_oraculo_shopee_take_rate_cache()
returns void
language sql
security definer
set search_path = public
set statement_timeout to '300s'
as $$
  delete from public.oraculo_shopee_take_rate_shop_daily_cache;
  insert into public.oraculo_shopee_take_rate_shop_daily_cache (
    order_date, shop_id, shop_name, orders_count, gross_amount, commission_fee,
    service_fee, transaction_fee, total_fees, voucher_from_shopee,
    voucher_from_seller, net_amount, take_rate_pct
  )
  select
    order_date, shop_id, shop_name, orders_count, gross_amount, commission_fee,
    service_fee, transaction_fee, total_fees, voucher_from_shopee,
    voucher_from_seller, net_amount, take_rate_pct
  from public.oraculo_shopee_take_rate_shop_daily;

  delete from public.oraculo_shopee_take_rate_sku_daily_cache;
  insert into public.oraculo_shopee_take_rate_sku_daily_cache (
    order_date, shop_id, shop_name, sku, product_name, orders_count, units,
    gross_amount, fees_allocated, net_amount, take_rate_pct, unit_cost,
    cost_total, net_profit, roi_pct
  )
  select
    order_date, shop_id, shop_name, sku, product_name, orders_count, units,
    gross_amount, fees_allocated, net_amount, take_rate_pct, unit_cost,
    cost_total, net_profit, roi_pct
  from public.oraculo_shopee_take_rate_sku_daily;
$$;

revoke all on function public.refresh_oraculo_shopee_take_rate_cache() from public, anon, authenticated;
grant execute on function public.refresh_oraculo_shopee_take_rate_cache() to service_role;

-- :12 e :42 para não colidir com os outros jobs horários (:05, :15, :25, :35,
-- :45, :50) nem com os syncs Shopee (0/3/6-59/15).
do $$
begin
  perform cron.unschedule('oraculo-shopee-take-rate-cache');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-shopee-take-rate-cache',
  '12,42 * * * *',
  $$ select public.refresh_oraculo_shopee_take_rate_cache(); $$
);

-- Popula já na migração para a aba não esperar o próximo tick do cron.
select public.refresh_oraculo_shopee_take_rate_cache();
