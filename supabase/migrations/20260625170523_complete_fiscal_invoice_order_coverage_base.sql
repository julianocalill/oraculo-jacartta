alter table public.oraculo_fiscal_invoice_order_links
  alter column order_id drop not null;

insert into public.oraculo_fiscal_invoice_order_links (
  invoice_id,
  order_id,
  issued_date,
  billed_revenue,
  marketplace_order_number,
  link_method,
  refreshed_at
)
select
  invoices.id,
  linked.id,
  invoices.issued_date,
  invoices.billed_revenue,
  invoices.order_number,
  case when linked.id is null then 'unmatched' else 'ecommerce.numeroPedidoEcommerce' end,
  now()
from public.oraculo_fiscal_invoices_valid invoices
left join lateral (
  select orders.id
  from public.olist_orders orders
  where orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = invoices.order_number
  order by orders.synced_at desc, orders.data_criacao desc nulls last, orders.id desc
  limit 1
) linked on true
where not exists (
  select 1
  from public.oraculo_fiscal_invoice_order_links existing
  where existing.invoice_id = invoices.id
)
on conflict (invoice_id) do nothing;

create or replace function public.refresh_oraculo_fiscal_invoice_order_links(
  p_start_date date,
  p_end_date date
)
returns bigint
language sql
set search_path = public
as $$
  with missing as (
    select
      invoices.id as invoice_id,
      invoices.issued_date,
      invoices.billed_revenue,
      invoices.order_number as marketplace_order_number
    from public.oraculo_fiscal_invoices_valid invoices
    left join public.oraculo_fiscal_invoice_order_links existing
      on existing.invoice_id = invoices.id
    where invoices.issued_date between p_start_date and p_end_date
      and existing.invoice_id is null
  ),
  matches as (
    select
      missing.*,
      linked.id as order_id
    from missing
    left join lateral (
      select orders.id
      from public.olist_orders orders
      where orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = missing.marketplace_order_number
      order by orders.synced_at desc, orders.data_criacao desc nulls last, orders.id desc
      limit 1
    ) linked on true
  ),
  inserted as (
    insert into public.oraculo_fiscal_invoice_order_links (
      invoice_id,
      order_id,
      issued_date,
      billed_revenue,
      marketplace_order_number,
      link_method,
      refreshed_at
    )
    select
      matches.invoice_id,
      matches.order_id,
      matches.issued_date,
      matches.billed_revenue,
      matches.marketplace_order_number,
      case when matches.order_id is null then 'unmatched' else 'ecommerce.numeroPedidoEcommerce' end,
      now()
    from matches
    on conflict (invoice_id) do nothing
    returning 1
  )
  select count(*)::bigint from inserted;
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
  with base as materialized (
    select invoice_id, order_id, billed_revenue
    from public.oraculo_fiscal_invoice_order_links
    where issued_date between p_start_date and p_end_date
  ),
  item_orders as materialized (
    select distinct items.order_id
    from public.olist_order_items items
    join (
      select distinct order_id
      from base
      where order_id is not null
    ) linked on linked.order_id = items.order_id
  ),
  coverage as (
    select
      base.invoice_id,
      base.order_id,
      base.billed_revenue,
      item_orders.order_id is not null as has_order_items
    from base
    left join item_orders on item_orders.order_id = base.order_id
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
    from coverage
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
