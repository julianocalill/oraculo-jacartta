create index if not exists olist_invoice_items_invoice_id_sku_idx
  on public.olist_invoice_items (invoice_id, sku);

create index if not exists olist_orders_numero_pedido_idx
  on public.olist_orders (numero_pedido);

create or replace function public.oraculo_fiscal_invoice_items_coverage(
  start_date date,
  end_date date,
  sample_limit integer default 10
)
returns jsonb
language sql
stable
as $$
  with bounds as (
    select
      start_date::timestamptz as start_ts,
      (end_date + 1)::timestamptz as end_ts,
      greatest(1, least(coalesce(sample_limit, 10), 50)) as sample_limit
  ),
  valid as (
    select
      inv.id,
      inv.invoice_number,
      inv.issued_at,
      inv.issued_date,
      inv.client_name,
      inv.uf,
      inv.billed_revenue,
      inv.order_id,
      inv.order_number,
      inv.channel_label,
      inv.raw_json
    from public.oraculo_fiscal_invoices_valid inv
    cross join bounds b
    where inv.issued_at >= b.start_ts
      and inv.issued_at < b.end_ts
  ),
  invoice_item_invoice_ids as (
    select distinct invoice_id
    from public.olist_invoice_items
  ),
  order_item_order_ids as (
    select
      order_id,
      count(*)::bigint as item_rows,
      count(distinct nullif(sku, ''))::bigint as sku_count,
      coalesce(sum(quantidade), 0) as units,
      coalesce(sum(valor_total), 0) as item_revenue
    from public.olist_order_items
    group by order_id
  ),
  valid_with_links as (
    select
      v.*,
      exists (
        select 1
        from public.olist_invoice_items ii
        where ii.invoice_id = v.id
      ) as has_invoice_items,
      coalesce(v.order_id, linked_order.id) as linked_order_id,
      order_items.item_rows,
      order_items.sku_count,
      order_items.units,
      order_items.item_revenue
    from valid v
    left join public.olist_orders linked_order
      on linked_order.id = v.order_id
      or (
        nullif(v.order_id, '') is null
        and nullif(v.order_number, '') is not null
        and linked_order.numero_pedido = v.order_number
      )
    left join order_item_order_ids order_items
      on order_items.order_id = coalesce(v.order_id, linked_order.id)
  ),
  metrics as (
    select
      count(*)::bigint as total_valid_invoices,
      coalesce(sum(billed_revenue), 0) as total_valid_revenue,
      count(*) filter (where has_invoice_items)::bigint as invoices_with_invoice_items,
      coalesce(sum(billed_revenue) filter (where has_invoice_items), 0) as revenue_with_invoice_items,
      count(*) filter (where not has_invoice_items)::bigint as invoices_without_invoice_items,
      coalesce(sum(billed_revenue) filter (where not has_invoice_items), 0) as revenue_without_invoice_items,
      count(*) filter (where nullif(order_id, '') is not null or nullif(order_number, '') is not null)::bigint as invoices_with_order_reference,
      count(*) filter (where linked_order_id is not null)::bigint as invoices_with_matched_order,
      count(*) filter (where linked_order_id is not null and coalesce(item_rows, 0) > 0)::bigint as invoices_with_order_items,
      coalesce(sum(billed_revenue) filter (where linked_order_id is not null and coalesce(item_rows, 0) > 0), 0) as revenue_with_order_items,
      count(*) filter (where not (linked_order_id is not null and coalesce(item_rows, 0) > 0))::bigint as invoices_without_order_items,
      coalesce(sum(billed_revenue) filter (where not (linked_order_id is not null and coalesce(item_rows, 0) > 0)), 0) as revenue_without_order_items,
      coalesce(sum(item_rows), 0)::bigint as order_item_rows,
      coalesce(sum(units), 0) as order_item_units,
      coalesce(sum(item_revenue), 0) as order_item_revenue
    from valid_with_links
  ),
  invoice_skus as (
    select count(distinct nullif(ii.sku, ''))::bigint as distinct_invoice_item_skus
    from public.olist_invoice_items ii
    join valid v on v.id = ii.invoice_id
  ),
  order_skus as (
    select count(distinct nullif(oi.sku, ''))::bigint as distinct_order_item_skus
    from valid_with_links v
    join public.olist_order_items oi on oi.order_id = v.linked_order_id
  ),
  missing_invoice_item_examples as (
    select jsonb_agg(to_jsonb(sample) order by sample.issued_at) as rows
    from (
      select
        id,
        invoice_number,
        issued_at,
        client_name,
        uf,
        billed_revenue,
        order_id,
        order_number,
        channel_label
      from valid_with_links
      where not has_invoice_items
      order by issued_at, id
      limit (select sample_limit from bounds)
    ) sample
  ),
  linked_order_item_examples as (
    select jsonb_agg(to_jsonb(sample) order by sample.issued_at) as rows
    from (
      select
        v.id,
        v.invoice_number,
        v.issued_at,
        v.billed_revenue,
        v.order_id,
        v.order_number,
        v.linked_order_id,
        v.channel_label,
        v.item_rows,
        v.sku_count,
        v.units,
        v.item_revenue
      from valid_with_links v
      where v.linked_order_id is not null
        and coalesce(v.item_rows, 0) > 0
      order by v.issued_at, v.id
      limit (select sample_limit from bounds)
    ) sample
  )
  select jsonb_build_object(
    'period', jsonb_build_object('start', start_date, 'end', end_date),
    'metrics', to_jsonb(metrics.*),
    'sku_counts', jsonb_build_object(
      'distinct_invoice_item_skus', coalesce((select distinct_invoice_item_skus from invoice_skus), 0),
      'distinct_order_item_skus', coalesce((select distinct_order_item_skus from order_skus), 0)
    ),
    'coverage', jsonb_build_object(
      'invoice_item_invoice_pct',
        case when metrics.total_valid_invoices = 0 then 0 else round(metrics.invoices_with_invoice_items::numeric / metrics.total_valid_invoices * 100, 4) end,
      'invoice_item_revenue_pct',
        case when metrics.total_valid_revenue = 0 then 0 else round(metrics.revenue_with_invoice_items / metrics.total_valid_revenue * 100, 4) end,
      'order_link_invoice_pct',
        case when metrics.total_valid_invoices = 0 then 0 else round(metrics.invoices_with_matched_order::numeric / metrics.total_valid_invoices * 100, 4) end,
      'order_items_invoice_pct',
        case when metrics.total_valid_invoices = 0 then 0 else round(metrics.invoices_with_order_items::numeric / metrics.total_valid_invoices * 100, 4) end,
      'order_items_revenue_pct',
        case when metrics.total_valid_revenue = 0 then 0 else round(metrics.revenue_with_order_items / metrics.total_valid_revenue * 100, 4) end,
      'missing_order_items_revenue_pct',
        case when metrics.total_valid_revenue = 0 then 0 else round(metrics.revenue_without_order_items / metrics.total_valid_revenue * 100, 4) end
    ),
    'examples', jsonb_build_object(
      'valid_invoices_without_invoice_items', coalesce((select rows from missing_invoice_item_examples), '[]'::jsonb),
      'valid_invoices_with_order_items', coalesce((select rows from linked_order_item_examples), '[]'::jsonb)
    )
  )
  from metrics;
$$;
