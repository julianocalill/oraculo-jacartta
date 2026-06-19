create index if not exists olist_orders_data_faturamento_idx
  on public.olist_orders ((payload->>'dataFaturamento'));

create index if not exists olist_orders_situacao_data_criacao_idx
  on public.olist_orders (situacao, data_criacao);

create index if not exists olist_order_items_order_date_sku_idx
  on public.olist_order_items (order_data_criacao, sku);

create or replace function public.oraculo_parse_numeric(value text)
returns numeric
language sql
immutable
as $$
  select case
    when value is null or btrim(value) = '' then null
    when btrim(value) ~ '^-?[0-9]+([,.][0-9]+)?$' then replace(btrim(value), ',', '.')::numeric
    else null
  end;
$$;

create or replace function public.oraculo_nf_metrics(start_date date, end_date date)
returns table (
  confirmed_revenue numeric,
  emitted_count bigint,
  canceled_count bigint,
  pending_count bigint
)
language sql
stable
as $$
  with bounds as (
    select
      start_date::text as start_text,
      (end_date + 1)::text as end_text,
      start_date::timestamptz as start_ts,
      (end_date + 1)::timestamptz as end_ts
  ),
  emitted as (
    select
      o.id,
      coalesce(
        public.oraculo_parse_numeric(o.payload->>'valorTotalPedido'),
        public.oraculo_parse_numeric(o.payload->>'valor'),
        public.oraculo_parse_numeric(o.payload->>'valorTotalProdutos'),
        0
      ) as nf_value
    from public.olist_orders o
    cross join bounds b
    where o.payload->>'dataFaturamento' >= b.start_text
      and o.payload->>'dataFaturamento' < b.end_text
      and coalesce(o.situacao, o.payload->>'situacao', '') <> '8'
  )
  select
    coalesce((select sum(nf_value) from emitted), 0) as confirmed_revenue,
    coalesce((select count(*) from emitted), 0) as emitted_count,
    coalesce((
      select count(*)
      from public.olist_orders o
      cross join bounds b
      where coalesce(o.situacao, o.payload->>'situacao', '') = '8'
        and o.data_criacao >= b.start_ts
        and o.data_criacao < b.end_ts
    ), 0) as canceled_count,
    coalesce((
      select count(*)
      from public.olist_orders o
      cross join bounds b
      where coalesce(o.situacao, o.payload->>'situacao', '') <> '8'
        and o.data_criacao >= b.start_ts
        and o.data_criacao < b.end_ts
        and nullif(o.payload->>'dataFaturamento', '') is null
    ), 0) as pending_count;
$$;

create or replace function public.oraculo_sku_period_rank(start_date date, end_date date, result_limit integer default 10)
returns table (
  sku text,
  product_name text,
  category_name text,
  brand_name text,
  revenue_30d numeric,
  units_30d numeric,
  revenue_change_pct numeric,
  available_stock numeric,
  days_until_stockout numeric,
  last_sale_at timestamptz
)
language sql
stable
as $$
  select
    sales.sku,
    max(sales.product_name) as product_name,
    max(sales.category_name) as category_name,
    max(sales.brand_name) as brand_name,
    sum(coalesce(sales.effective_revenue, 0)) as revenue_30d,
    sum(coalesce(sales.units, 0)) as units_30d,
    null::numeric as revenue_change_pct,
    max(sales.available_stock) as available_stock,
    case
      when sum(coalesce(sales.units, 0)) <= 0 then null
      else max(sales.available_stock) / nullif(sum(coalesce(sales.units, 0)) / greatest((end_date - start_date + 1), 1), 0)
    end as days_until_stockout,
    max(sales.last_sale_at) as last_sale_at
  from public.oraculo_sku_sales sales
  where sales.order_date >= start_date
    and sales.order_date <= end_date
    and sales.sku is not null
  group by sales.sku
  order by sum(coalesce(sales.effective_revenue, 0)) desc
  limit greatest(1, least(coalesce(result_limit, 10), 100));
$$;
