create or replace function public.oraculo_fiscal_order_item_backfill_candidates(
  p_start_date date,
  p_end_date date,
  p_after_order_id text default null,
  p_limit integer default 100
)
returns table (
  order_id text,
  numero_pedido text,
  order_data_criacao timestamptz,
  order_payload jsonb,
  invoice_id text,
  invoice_number text,
  issued_at timestamptz,
  billed_revenue numeric,
  marketplace_order_number text
)
language sql
stable
set search_path = public
as $$
  with valid as materialized (
    select id, invoice_number, issued_at, billed_revenue, order_number
    from public.oraculo_fiscal_invoices_valid
    where issued_date between p_start_date and p_end_date
      and order_number is not null
  ),
  matched as materialized (
    select distinct on (valid.id)
      valid.id as invoice_id,
      valid.invoice_number,
      valid.issued_at,
      valid.billed_revenue,
      valid.order_number as marketplace_order_number,
      orders.id as order_id,
      orders.numero_pedido,
      orders.data_criacao as order_data_criacao,
      orders.payload as order_payload
    from valid
    join public.olist_orders orders
      on orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = valid.order_number
    order by valid.id, orders.synced_at desc, orders.data_criacao desc nulls last, orders.id desc
  ),
  unique_orders as (
    select distinct on (matched.order_id)
      matched.*
    from matched
    where (p_after_order_id is null or matched.order_id > p_after_order_id)
      and not exists (
        select 1
        from public.olist_order_items items
        where items.order_id = matched.order_id
      )
    order by matched.order_id, matched.issued_at, matched.invoice_id
  )
  select
    unique_orders.order_id,
    unique_orders.numero_pedido,
    unique_orders.order_data_criacao,
    unique_orders.order_payload,
    unique_orders.invoice_id,
    unique_orders.invoice_number,
    unique_orders.issued_at,
    unique_orders.billed_revenue,
    unique_orders.marketplace_order_number
  from unique_orders
  order by unique_orders.order_id
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

create or replace function public.oraculo_fiscal_order_item_backfill_candidate_count(
  p_start_date date,
  p_end_date date
)
returns bigint
language sql
stable
set search_path = public
as $$
  with valid as materialized (
    select id, order_number
    from public.oraculo_fiscal_invoices_valid
    where issued_date between p_start_date and p_end_date
      and order_number is not null
  ),
  matched as materialized (
    select distinct on (valid.id)
      valid.id as invoice_id,
      orders.id as order_id
    from valid
    join public.olist_orders orders
      on orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = valid.order_number
    order by valid.id, orders.synced_at desc, orders.data_criacao desc nulls last, orders.id desc
  )
  select count(distinct matched.order_id)
  from matched
  where not exists (
    select 1
    from public.olist_order_items items
    where items.order_id = matched.order_id
  );
$$;

create or replace function public.oraculo_fiscal_order_item_backfill_progress(
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with valid as materialized (
    select id, billed_revenue, order_number
    from public.oraculo_fiscal_invoices_valid
    where issued_date between p_start_date and p_end_date
  ),
  matched as materialized (
    select distinct on (valid.id)
      valid.id as invoice_id,
      orders.id as order_id
    from valid
    join public.olist_orders orders
      on valid.order_number is not null
     and orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = valid.order_number
    order by valid.id, orders.synced_at desc, orders.data_criacao desc nulls last, orders.id desc
  ),
  item_orders as materialized (
    select distinct items.order_id
    from public.olist_order_items items
    join (
      select distinct order_id
      from matched
    ) linked on linked.order_id = items.order_id
  ),
  invoice_coverage as (
    select
      valid.id as invoice_id,
      valid.billed_revenue,
      matched.order_id,
      item_orders.order_id is not null as has_order_items
    from valid
    left join matched on matched.invoice_id = valid.id
    left join item_orders on item_orders.order_id = matched.order_id
  ),
  metrics as (
    select
      count(*)::bigint as total_valid_invoices,
      coalesce(sum(billed_revenue), 0) as total_valid_revenue,
      count(*) filter (where order_id is not null)::bigint as invoices_with_matched_order,
      count(*) filter (where has_order_items)::bigint as invoices_with_order_items,
      coalesce(sum(billed_revenue) filter (where has_order_items), 0) as revenue_with_order_items,
      count(*) filter (where not has_order_items)::bigint as invoices_without_order_items,
      coalesce(sum(billed_revenue) filter (where not has_order_items), 0) as revenue_without_order_items
    from invoice_coverage
  ),
  sku_count as (
    select count(distinct nullif(items.sku, ''))::bigint as distinct_order_item_skus
    from item_orders
    join public.olist_order_items items on items.order_id = item_orders.order_id
  )
  select jsonb_build_object(
    'metrics', to_jsonb(metrics.*),
    'coverage', jsonb_build_object(
      'order_link_invoice_pct',
        case when metrics.total_valid_invoices = 0 then 0 else round(metrics.invoices_with_matched_order::numeric / metrics.total_valid_invoices * 100, 4) end,
      'order_items_invoice_pct',
        case when metrics.total_valid_invoices = 0 then 0 else round(metrics.invoices_with_order_items::numeric / metrics.total_valid_invoices * 100, 4) end,
      'order_items_revenue_pct',
        case when metrics.total_valid_revenue = 0 then 0 else round(metrics.revenue_with_order_items / metrics.total_valid_revenue * 100, 4) end,
      'missing_order_items_revenue_pct',
        case when metrics.total_valid_revenue = 0 then 0 else round(metrics.revenue_without_order_items / metrics.total_valid_revenue * 100, 4) end
    ),
    'distinct_order_item_skus', coalesce((select distinct_order_item_skus from sku_count), 0)
  )
  from metrics;
$$;
