create or replace function public.oraculo_fiscal_order_item_backfill_progress(
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with linked_invoices as (
    select
      invoices.id as invoice_id,
      invoices.billed_revenue,
      linked.id as order_id,
      exists (
        select 1
        from public.olist_order_items items
        where items.order_id = linked.id
      ) as has_order_items
    from public.oraculo_fiscal_invoices_valid invoices
    left join lateral (
      select orders.id
      from public.olist_orders orders
      where orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = invoices.order_number
      order by orders.synced_at desc, orders.data_criacao desc nulls last, orders.id desc
      limit 1
    ) linked on true
    where invoices.issued_date between p_start_date and p_end_date
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
    from linked_invoices
  ),
  sku_count as (
    select count(distinct nullif(items.sku, ''))::bigint as distinct_order_item_skus
    from (
      select distinct order_id
      from linked_invoices
      where has_order_items
    ) linked
    join public.olist_order_items items on items.order_id = linked.order_id
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
