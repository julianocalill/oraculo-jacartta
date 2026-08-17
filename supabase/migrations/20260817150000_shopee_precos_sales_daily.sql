-- Filtro de período na aba /shopee/precos: vendas por anúncio/variação/dia
-- (últimos 60 dias), para filtrar por data e intervalo de data combinado com
-- busca por produto/SKU. Agregar 170k+ pedidos ao vivo por request estouraria
-- o compute; o agregado diário é recalculado no MESMO ciclo horário do cache
-- de preço×custo (edge function shopee-price-product-refresh, cron :57) — sem
-- job novo de cron. A página lê um intervalo via RPC (indexado, resultado
-- pequeno).

create table if not exists public.oraculo_shopee_precos_sales_daily (
  shop_id bigint not null,
  item_id text not null,
  model_id text not null default '0',
  sale_date date not null,
  units integer not null default 0,
  orders_count integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (shop_id, item_id, model_id, sale_date)
);

create index if not exists oraculo_shopee_precos_sales_daily_date_idx
  on public.oraculo_shopee_precos_sales_daily (sale_date);

alter table public.oraculo_shopee_precos_sales_daily enable row level security;
revoke all on table public.oraculo_shopee_precos_sales_daily from public, anon, authenticated;
grant all on table public.oraculo_shopee_precos_sales_daily to service_role;

comment on table public.oraculo_shopee_precos_sales_daily is
  'Vendas Shopee por anúncio/variação/dia (60 dias). Recalculado de hora em hora junto com oraculo_shopee_price_product_cache; CANCELLED e UNPAID ficam de fora.';

-- Recalcula a janela inteira (60d). Delete+insert na mesma transação (MVCC).
create or replace function public.refresh_oraculo_shopee_precos_sales_daily()
returns void
language sql
security definer
set search_path = public
set statement_timeout to '120s'
as $$
  delete from oraculo_shopee_precos_sales_daily;
  insert into oraculo_shopee_precos_sales_daily
    (shop_id, item_id, model_id, sale_date, units, orders_count, refreshed_at)
  select oi.shop_id,
         oi.item_id,
         coalesce(nullif(oi.model_id, ''), '0'),
         (o.create_time at time zone 'America/Sao_Paulo')::date,
         sum(oi.quantity),
         count(distinct oi.order_sn),
         now()
    from shopee_order_items oi
    join shopee_orders o on o.id = oi.order_id
   where o.create_time > now() - interval '60 days'
     and o.order_status not in ('CANCELLED', 'UNPAID')
     and oi.item_id is not null
   group by 1, 2, 3, 4;
$$;

revoke all on function public.refresh_oraculo_shopee_precos_sales_daily() from public, anon, authenticated;
grant execute on function public.refresh_oraculo_shopee_precos_sales_daily() to service_role;

-- Agregação por intervalo para a página (resultado: uma linha por anúncio).
create or replace function public.oraculo_shopee_precos_vendas_periodo(p_from date, p_to date)
returns table (shop_id bigint, item_id text, model_id text, units bigint, orders_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select s.shop_id, s.item_id, s.model_id,
         sum(s.units)::bigint, sum(s.orders_count)::bigint
    from oraculo_shopee_precos_sales_daily s
   where s.sale_date between p_from and p_to
   group by 1, 2, 3;
$$;

revoke all on function public.oraculo_shopee_precos_vendas_periodo(date, date) from public, anon, authenticated;
grant execute on function public.oraculo_shopee_precos_vendas_periodo(date, date) to service_role;

-- Popula já na migração
select public.refresh_oraculo_shopee_precos_sales_daily();
