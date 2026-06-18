create schema if not exists private;

create or replace function private.try_numeric(value text)
returns numeric
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;

  return replace(value, ',', '.')::numeric;
exception
  when others then
    return null;
end;
$$;

create or replace view public.oraculo_order_facts
with (security_invoker = true)
as
select
  o.id as order_id,
  o.numero_pedido,
  o.data_criacao,
  o.data_criacao::date as order_date,
  o.situacao as status_code,
  coalesce(s.label, o.situacao, 'Sem status') as status_label,
  coalesce(s.funnel_stage, 'unknown') as funnel_stage,
  coalesce(s.is_canceled, o.situacao = '8', false) as is_canceled,
  c.id as channel_id,
  coalesce(c.display_name, o.payload #>> '{ecommerce,nome}', 'Sem canal') as channel_name,
  coalesce(
    sum(oi.valor_total),
    private.try_numeric(o.payload #>> '{total}'),
    private.try_numeric(o.payload #>> '{valorTotal}'),
    private.try_numeric(o.payload #>> '{valor_total}'),
    private.try_numeric(o.payload #>> '{totalPedido}'),
    private.try_numeric(o.payload #>> '{totais,total}'),
    0
  ) as gross_revenue,
  coalesce(sum(oi.quantidade), 0) as units,
  count(oi.id) as line_count,
  o.synced_at
from public.olist_orders o
left join public.olist_order_items oi
  on oi.order_id = o.id
left join public.dim_order_status s
  on s.source = 'olist'
  and s.code = o.situacao
left join public.dim_channels c
  on c.source = 'olist'
  and (
    c.source_id = o.payload #>> '{ecommerce,id}'
    or c.source_name = o.payload #>> '{ecommerce,nome}'
  )
group by
  o.id,
  o.numero_pedido,
  o.data_criacao,
  o.situacao,
  s.label,
  s.funnel_stage,
  s.is_canceled,
  c.id,
  c.display_name,
  o.payload,
  o.synced_at;

create or replace view public.oraculo_daily_sales
with (security_invoker = true)
as
select
  order_date,
  sum(gross_revenue) as gross_revenue,
  sum(case when is_canceled then 0 else gross_revenue end) as effective_revenue,
  count(*) as orders_count,
  count(*) filter (where is_canceled) as canceled_orders,
  sum(units) as units,
  case
    when count(*) filter (where not is_canceled) = 0 then 0
    else sum(case when is_canceled then 0 else gross_revenue end)
      / count(*) filter (where not is_canceled)
  end as average_ticket
from public.oraculo_order_facts
where order_date is not null
group by order_date;

create or replace view public.oraculo_channel_sales
with (security_invoker = true)
as
select
  date_trunc('week', data_criacao)::date as week_start,
  channel_id,
  channel_name,
  sum(gross_revenue) as gross_revenue,
  sum(case when is_canceled then 0 else gross_revenue end) as effective_revenue,
  count(*) as orders_count,
  count(*) filter (where is_canceled) as canceled_orders,
  sum(units) as units,
  case
    when count(*) filter (where not is_canceled) = 0 then 0
    else sum(case when is_canceled then 0 else gross_revenue end)
      / count(*) filter (where not is_canceled)
  end as average_ticket
from public.oraculo_order_facts
where data_criacao is not null
group by 1, channel_id, channel_name;

create or replace view public.oraculo_sku_sales
with (security_invoker = true)
as
select
  oi.sku,
  coalesce(p.nome, oi.descricao, 'Sem nome') as product_name,
  coalesce(p.categoria_nome, 'Sem categoria') as category_name,
  coalesce(p.marca_nome, 'Sem marca') as brand_name,
  oi.order_data_criacao::date as order_date,
  date_trunc('week', oi.order_data_criacao)::date as week_start,
  sum(oi.quantidade) as units,
  sum(coalesce(oi.valor_total, oi.quantidade * oi.valor_unitario, 0)) as gross_revenue,
  sum(
    case
      when coalesce(s.is_canceled, o.situacao = '8', false) then 0
      else coalesce(oi.valor_total, oi.quantidade * oi.valor_unitario, 0)
    end
  ) as effective_revenue,
  count(distinct oi.order_id) as orders_count,
  max(st.disponivel) as available_stock,
  max(st.saldo) as stock_balance,
  max(p.preco_custo_medio) as average_cost,
  max(p.preco_custo) as unit_cost,
  max(oi.order_data_criacao) as last_sale_at
from public.olist_order_items oi
join public.olist_orders o
  on o.id = oi.order_id
left join public.dim_order_status s
  on s.source = 'olist'
  and s.code = o.situacao
left join public.olist_products p
  on p.id = oi.produto_id
  or (p.sku is not null and p.sku = oi.sku)
left join public.olist_stock_items st
  on st.produto_id = oi.produto_id
  or (st.sku is not null and st.sku = oi.sku)
where oi.sku is not null
group by
  oi.sku,
  coalesce(p.nome, oi.descricao, 'Sem nome'),
  coalesce(p.categoria_nome, 'Sem categoria'),
  coalesce(p.marca_nome, 'Sem marca'),
  oi.order_data_criacao::date,
  date_trunc('week', oi.order_data_criacao)::date;

create or replace view public.oraculo_sku_current
with (security_invoker = true)
as
with sku_30d as (
  select
    sku,
    max(product_name) as product_name,
    max(category_name) as category_name,
    max(brand_name) as brand_name,
    sum(units) as units_30d,
    sum(effective_revenue) as revenue_30d,
    max(last_sale_at) as last_sale_at
  from public.oraculo_sku_sales
  where order_date >= current_date - interval '30 days'
  group by sku
),
sku_prev_30d as (
  select
    sku,
    sum(units) as units_prev_30d,
    sum(effective_revenue) as revenue_prev_30d
  from public.oraculo_sku_sales
  where order_date >= current_date - interval '60 days'
    and order_date < current_date - interval '30 days'
  group by sku
)
select
  p.sku,
  coalesce(p.nome, s.product_name, 'Sem nome') as product_name,
  coalesce(p.categoria_nome, s.category_name, 'Sem categoria') as category_name,
  coalesce(p.marca_nome, s.brand_name, 'Sem marca') as brand_name,
  coalesce(s.units_30d, 0) as units_30d,
  coalesce(s.revenue_30d, 0) as revenue_30d,
  coalesce(prev.units_prev_30d, 0) as units_prev_30d,
  coalesce(prev.revenue_prev_30d, 0) as revenue_prev_30d,
  case
    when coalesce(prev.revenue_prev_30d, 0) = 0 then null
    else (coalesce(s.revenue_30d, 0) - prev.revenue_prev_30d) / prev.revenue_prev_30d
  end as revenue_change_pct,
  p.disponivel as available_stock,
  p.saldo as stock_balance,
  case
    when coalesce(s.units_30d, 0) <= 0 then null
    else p.disponivel / nullif(s.units_30d / 30.0, 0)
  end as days_until_stockout,
  coalesce(p.preco_custo_medio, p.preco_custo) as unit_cost,
  p.disponivel * coalesce(p.preco_custo_medio, p.preco_custo, 0) as stock_value,
  s.last_sale_at
from public.olist_products p
left join sku_30d s
  on s.sku = p.sku
left join sku_prev_30d prev
  on prev.sku = p.sku
where p.sku is not null;

create or replace view public.oraculo_stock_watchlist
with (security_invoker = true)
as
select
  sku,
  product_name,
  category_name,
  brand_name,
  available_stock,
  stock_balance,
  units_30d,
  revenue_30d,
  days_until_stockout,
  last_sale_at,
  case
    when coalesce(available_stock, 0) <= 0 then 'ruptura'
    when days_until_stockout is not null and days_until_stockout <= 7 then 'ruptura_iminente'
    when last_sale_at is null then 'sem_venda'
    when last_sale_at < now() - interval '30 days' then 'parado'
    else 'ok'
  end as stock_signal
from public.oraculo_sku_current
where coalesce(available_stock, 0) <= 5
  or (days_until_stockout is not null and days_until_stockout <= 14)
  or last_sale_at is null
  or last_sale_at < now() - interval '30 days';
