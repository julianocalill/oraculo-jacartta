-- Separa venda de marketplace de venda fora de canal na aba "Mais Vendidos".
--
-- Motivo (achado em 28/07): o pedido 663383 (id 367958030), de 27/07, tem
-- 213.960 unidades de "CABIDE DE VELUDO - PRETO" a R$ 0,84 — R$ 179.726,40.
-- O dado é legítimo no Olist (valorTotalPedido bate exatamente), mas é venda
-- B2B/atacado lançada direto no ERP: `payload.ecommerce.nome` vem vazio.
--
-- É 1 pedido em 25.365 na janela de 7 dias, e sozinho vale mais unidades que
-- todos os marketplaces somados (213.960 contra ~10.000). Com ele dentro, um
-- cabide vira o produto mais vendido do dia por 200x e a tela deixa de
-- responder a pergunta que se propõe a responder.
--
-- Decisão: os rankings passam a ser de marketplace (pedido com canal). O
-- volume fora de canal NÃO é descartado — continua no cache, agregado à parte,
-- e a tela mostra quando existe. Assim o número segue auditável.

-- O cache de SKU não tinha a dimensão de canal, então não dava para filtrar na
-- leitura. `has_channel` é o mínimo necessário: no máximo dobra as linhas e
-- mantém os dois lados recuperáveis.
drop table if exists public.oraculo_olist_qty_sku_daily_cache;

create table public.oraculo_olist_qty_sku_daily_cache (
  order_date date not null,
  sku text not null,
  has_channel boolean not null default true,
  product_name text,
  units numeric not null default 0,
  orders_count bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (order_date, sku, has_channel)
);

create index if not exists oraculo_olist_qty_sku_cache_date_units_idx
  on public.oraculo_olist_qty_sku_daily_cache (order_date, units desc);

alter table public.oraculo_olist_qty_sku_daily_cache enable row level security;

drop policy if exists oraculo_authenticated_read on public.oraculo_olist_qty_sku_daily_cache;
create policy oraculo_authenticated_read
  on public.oraculo_olist_qty_sku_daily_cache
  for select to authenticated using (true);

grant select on public.oraculo_olist_qty_sku_daily_cache to authenticated;
grant all on public.oraculo_olist_qty_sku_daily_cache to service_role;

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
  -- Materializa canal + status por pedido UMA vez. Extrair o canal do payload
  -- é o passo caro (jsonb detoast em 957 MB de tabela); fazer isso duas vezes,
  -- uma para o cache de canal e outra para o de SKU, estourava o
  -- statement_timeout. Com a temp table o payload é lido uma vez só.
  create temp table _win_orders on commit drop as
  select
    o.id,
    o.data_criacao::date as order_date,
    coalesce(nullif(o.payload #>> '{ecommerce,nome}', ''), 'Sem canal') as channel_name,
    coalesce(s.is_canceled, o.situacao = '8', false) as is_canceled
  from public.olist_orders o
  left join public.dim_order_status s
    on s.source = 'olist' and s.code = o.situacao
  where o.data_criacao >= cutoff::timestamptz;

  create index on _win_orders (id);
  analyze _win_orders;

  delete from public.oraculo_olist_qty_channel_daily_cache where order_date >= cutoff;

  insert into public.oraculo_olist_qty_channel_daily_cache
    (order_date, channel_name, orders_valid, orders_canceled, orders_with_items, units)
  with window_orders as (
    select * from _win_orders
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
    (order_date, sku, has_channel, product_name, units, orders_count)
  select
    oi.order_data_criacao::date,
    coalesce(nullif(oi.sku, ''), nullif(oi.produto_id, ''), 'sem-sku'),
    w.channel_name <> 'Sem canal',
    coalesce(max(p.nome), max(oi.descricao), 'Sem nome'),
    sum(oi.quantidade),
    count(distinct oi.order_id)
  from public.olist_order_items oi
  join _win_orders w
    on w.id = oi.order_id
  left join public.olist_products p
    on p.id = oi.produto_id
    or (p.sku is not null and p.sku = oi.sku)
  where oi.order_data_criacao >= cutoff::timestamptz
    and not w.is_canceled
  group by 1, 2, 3;
end;
$$;

revoke all on function public.refresh_oraculo_olist_qty_cache(integer) from public, anon, authenticated;
grant execute on function public.refresh_oraculo_olist_qty_cache(integer) to service_role;

-- Cobertura passa a devolver marketplace e fora-de-canal lado a lado, para a
-- tela poder mostrar o segundo sem misturar no primeiro.
drop function if exists public.oraculo_olist_period_coverage(date, date);

create or replace function public.oraculo_olist_period_coverage(
  start_date date,
  end_date date
)
returns table (
  orders_valid bigint,
  orders_canceled bigint,
  orders_with_items bigint,
  units numeric,
  offmarket_orders bigint,
  offmarket_units numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(orders_valid) filter (where channel_name <> 'Sem canal'), 0)::bigint,
    coalesce(sum(orders_canceled) filter (where channel_name <> 'Sem canal'), 0)::bigint,
    coalesce(sum(orders_with_items) filter (where channel_name <> 'Sem canal'), 0)::bigint,
    coalesce(sum(units) filter (where channel_name <> 'Sem canal'), 0),
    coalesce(sum(orders_valid) filter (where channel_name = 'Sem canal'), 0)::bigint,
    coalesce(sum(units) filter (where channel_name = 'Sem canal'), 0)
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
    and c.has_channel
  group by c.sku
  order by units desc, orders_count desc
  limit result_limit;
$$;

drop function if exists public.oraculo_top_channels_qty(date, date);

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
    and c.channel_name <> 'Sem canal'
  group by c.channel_name
  order by units desc, orders_valid desc;
$$;

grant execute on function public.oraculo_olist_period_coverage(date, date) to authenticated;
grant execute on function public.oraculo_top_products_qty(date, date, integer) to authenticated;
grant execute on function public.oraculo_top_channels_qty(date, date) to authenticated;

select public.refresh_oraculo_olist_qty_cache(21);
