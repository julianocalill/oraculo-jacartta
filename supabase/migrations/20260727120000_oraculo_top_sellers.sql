-- Aba "Mais Vendidos": ranking por quantidade (Olist), produtos e lojas.
--
-- Duas restrições moldaram este desenho:
--
-- 1) O nome da loja só existe dentro de `olist_orders.payload` (jsonb). A
--    tabela tem 330 mil linhas / 957 MB, e destoastar o payload numa janela de
--    7 dias (29 mil pedidos) custa 5s contra 1,4s da mesma contagem sem tocar
--    no payload. No compute Nano isso estoura o statement_timeout.
-- 2) `olist_order_items` cobre só parte dos pedidos (26% em 21/07, 100% em
--    26/07 — o backfill de itens corre atrás do importador de pedidos). Contar
--    pedidos a partir dos itens subestima o volume real, então as duas
--    contagens andam separadas:
--      quantidade -> olist_order_items (parcial, única fonte de unidades)
--      pedidos    -> olist_orders      (completo)
--    e a cobertura vai junto para a tela poder mostrar o buraco.
--
-- Mesma solução do take rate Shopee (20260722120000) e da NF
-- (oraculo_nf_daily_cache): cache diário + pg_cron. A agregação pesada roda de
-- hora em hora sobre uma janela móvel; a página lê algumas centenas de linhas.

create table if not exists public.oraculo_olist_qty_channel_daily_cache (
  order_date date not null,
  channel_name text not null,
  orders_valid bigint not null default 0,
  orders_canceled bigint not null default 0,
  orders_with_items bigint not null default 0,
  units numeric not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (order_date, channel_name)
);

create table if not exists public.oraculo_olist_qty_sku_daily_cache (
  order_date date not null,
  sku text not null,
  product_name text,
  units numeric not null default 0,
  orders_count bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (order_date, sku)
);

create index if not exists oraculo_olist_qty_sku_cache_date_units_idx
  on public.oraculo_olist_qty_sku_daily_cache (order_date, units desc);

-- Leitura pela página vai pelo client autenticado (padrão do projeto para dado
-- de negócio): RLS + policy de leitura + grant select.
alter table public.oraculo_olist_qty_channel_daily_cache enable row level security;
alter table public.oraculo_olist_qty_sku_daily_cache enable row level security;

drop policy if exists oraculo_authenticated_read on public.oraculo_olist_qty_channel_daily_cache;
create policy oraculo_authenticated_read
  on public.oraculo_olist_qty_channel_daily_cache
  for select to authenticated using (true);

drop policy if exists oraculo_authenticated_read on public.oraculo_olist_qty_sku_daily_cache;
create policy oraculo_authenticated_read
  on public.oraculo_olist_qty_sku_daily_cache
  for select to authenticated using (true);

grant select on public.oraculo_olist_qty_channel_daily_cache to authenticated;
grant select on public.oraculo_olist_qty_sku_daily_cache to authenticated;
grant all on public.oraculo_olist_qty_channel_daily_cache to service_role;
grant all on public.oraculo_olist_qty_sku_daily_cache to service_role;

-- Janela móvel. O cron passa 10 dias: cobre o filtro máximo da tela (7 dias)
-- com margem e ainda reprocessa os dias que o backfill de pedidos preenche
-- depois — 21/07 saiu de ~1.500 para 6.057 pedidos dias depois do fato.
-- Custo medido: 10 dias = 32s, 21 dias = 106s. Dias fora da janela ficam
-- congelados de propósito; varrer mais a cada hora drenaria os créditos de CPU
-- que as outras abas dependem no compute Nano.
create or replace function public.refresh_oraculo_olist_qty_cache(
  lookback_days integer default 21
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff date := current_date - greatest(lookback_days, 1);
begin
  delete from public.oraculo_olist_qty_channel_daily_cache where order_date >= cutoff;

  insert into public.oraculo_olist_qty_channel_daily_cache
    (order_date, channel_name, orders_valid, orders_canceled, orders_with_items, units)
  with window_orders as (
    select
      o.id,
      o.data_criacao::date as order_date,
      coalesce(nullif(o.payload #>> '{ecommerce,nome}', ''), 'Sem canal') as channel_name,
      coalesce(s.is_canceled, o.situacao = '8', false) as is_canceled
    from public.olist_orders o
    left join public.dim_order_status s
      on s.source = 'olist' and s.code = o.situacao
    where o.data_criacao >= cutoff::timestamptz
  ),
  item_totals as (
    select oi.order_id, sum(oi.quantidade) as units
    from public.olist_order_items oi
    where oi.order_data_criacao >= cutoff::timestamptz
    group by oi.order_id
  )
  select
    w.order_date,
    w.channel_name,
    count(*) filter (where not w.is_canceled),
    count(*) filter (where w.is_canceled),
    count(i.order_id) filter (where not w.is_canceled),
    coalesce(sum(i.units) filter (where not w.is_canceled), 0)
  from window_orders w
  left join item_totals i on i.order_id = w.id
  group by w.order_date, w.channel_name;

  delete from public.oraculo_olist_qty_sku_daily_cache where order_date >= cutoff;

  insert into public.oraculo_olist_qty_sku_daily_cache
    (order_date, sku, product_name, units, orders_count)
  select
    oi.order_data_criacao::date,
    coalesce(nullif(oi.sku, ''), nullif(oi.produto_id, ''), 'sem-sku'),
    coalesce(max(p.nome), max(oi.descricao), 'Sem nome'),
    sum(oi.quantidade),
    count(distinct oi.order_id)
  from public.olist_order_items oi
  join public.olist_orders o
    on o.id = oi.order_id
  left join public.dim_order_status s
    on s.source = 'olist' and s.code = o.situacao
  left join public.olist_products p
    on p.id = oi.produto_id
    or (p.sku is not null and p.sku = oi.sku)
  where oi.order_data_criacao >= cutoff::timestamptz
    and not coalesce(s.is_canceled, o.situacao = '8', false)
  group by 1, 2;
end;
$$;

revoke all on function public.refresh_oraculo_olist_qty_cache(integer) from public, anon, authenticated;
grant execute on function public.refresh_oraculo_olist_qty_cache(integer) to service_role;

-- Último dia presente no cache. A tela ancora as janelas nele em vez de em
-- current_date: com o importador atrasado (em 27/07 o pedido mais novo era de
-- 26/07), ancorar em "hoje" renderiza uma tela vazia.
create or replace function public.oraculo_olist_last_order_date()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select max(order_date) from public.oraculo_olist_qty_channel_daily_cache;
$$;

drop function if exists public.oraculo_olist_period_coverage(date, date);

create or replace function public.oraculo_olist_period_coverage(
  start_date date,
  end_date date
)
returns table (
  orders_valid bigint,
  orders_canceled bigint,
  orders_with_items bigint,
  units numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(orders_valid), 0)::bigint,
    coalesce(sum(orders_canceled), 0)::bigint,
    coalesce(sum(orders_with_items), 0)::bigint,
    coalesce(sum(units), 0)
  from public.oraculo_olist_qty_channel_daily_cache
  where order_date between start_date and end_date;
$$;

drop function if exists public.oraculo_top_products_qty(date, date, integer);

create or replace function public.oraculo_top_products_qty(
  start_date date,
  end_date date,
  result_limit integer default 100
)
returns table (
  sku text,
  product_name text,
  units numeric,
  orders_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.sku,
    max(c.product_name) as product_name,
    sum(c.units) as units,
    sum(c.orders_count)::bigint as orders_count
  from public.oraculo_olist_qty_sku_daily_cache c
  where c.order_date between start_date and end_date
  group by c.sku
  order by units desc, orders_count desc
  limit result_limit;
$$;

drop function if exists public.oraculo_top_channels_qty(date, date);

-- O display_name de dim_channels entra só aqui, no grão agregado (14 linhas),
-- e não por pedido — é o que mantém o payload fora do caminho quente.
create or replace function public.oraculo_top_channels_qty(
  start_date date,
  end_date date
)
returns table (
  channel_name text,
  orders_valid bigint,
  orders_with_items bigint,
  units numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(max(d.display_name), c.channel_name) as channel_name,
    sum(c.orders_valid)::bigint as orders_valid,
    sum(c.orders_with_items)::bigint as orders_with_items,
    sum(c.units) as units
  from public.oraculo_olist_qty_channel_daily_cache c
  left join public.dim_channels d
    on d.source = 'olist' and d.source_name = c.channel_name
  where c.order_date between start_date and end_date
  group by c.channel_name
  order by units desc, orders_valid desc;
$$;

grant execute on function public.oraculo_olist_last_order_date() to authenticated;
grant execute on function public.oraculo_olist_period_coverage(date, date) to authenticated;
grant execute on function public.oraculo_top_products_qty(date, date, integer) to authenticated;
grant execute on function public.oraculo_top_channels_qty(date, date) to authenticated;

-- :20 — slot livre entre os jobs existentes (:05, :12, :15, :25, :35, :42, :45, :50).
do $$
begin
  perform cron.unschedule('oraculo-olist-qty-cache');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-qty-cache',
  '20 * * * *',
  $$ select public.refresh_oraculo_olist_qty_cache(10); $$
);

-- Popula já na migração (21 dias) para a aba não esperar o próximo tick.
select public.refresh_oraculo_olist_qty_cache(21);
