create index if not exists olist_orders_ecommerce_numero_pedido_idx
  on public.olist_orders ((payload->'ecommerce'->>'numeroPedidoEcommerce'));

create index if not exists olist_orders_ecommerce_numero_canal_idx
  on public.olist_orders ((payload->'ecommerce'->>'numeroPedidoCanalVenda'));

create index if not exists olist_orders_numero_ordem_compra_idx
  on public.olist_orders ((payload->>'numeroOrdemCompra'));

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
      nullif(inv.order_id, '') as order_id,
      nullif(inv.order_number, '') as order_number,
      inv.channel_label
    from public.oraculo_fiscal_invoices_valid inv
    cross join bounds b
    where inv.issued_at >= b.start_ts
      and inv.issued_at < b.end_ts
  ),
  invoice_item_flags as (
    select
      ii.invoice_id,
      count(*)::bigint as item_rows,
      count(distinct nullif(ii.sku, ''))::bigint as sku_count
    from public.olist_invoice_items ii
    join valid v on v.id = ii.invoice_id
    group by ii.invoice_id
  ),
  matched_orders as (
    select distinct on (invoice_id)
      invoice_id,
      linked_order_id,
      link_method
    from (
      select v.id as invoice_id, o.id as linked_order_id, 'order_id'::text as link_method
      from valid v
      join public.olist_orders o on v.order_id is not null and o.id = v.order_id

      union all

      select v.id as invoice_id, o.id as linked_order_id, 'ecommerce.numeroPedidoEcommerce'::text as link_method
      from valid v
      join public.olist_orders o
        on v.order_number is not null
       and o.payload->'ecommerce'->>'numeroPedidoEcommerce' = v.order_number

      union all

      select v.id as invoice_id, o.id as linked_order_id, 'ecommerce.numeroPedidoCanalVenda'::text as link_method
      from valid v
      join public.olist_orders o
        on v.order_number is not null
       and o.payload->'ecommerce'->>'numeroPedidoCanalVenda' = v.order_number

      union all

      select v.id as invoice_id, o.id as linked_order_id, 'numeroOrdemCompra'::text as link_method
      from valid v
      join public.olist_orders o
        on v.order_number is not null
       and o.payload->>'numeroOrdemCompra' = v.order_number

      union all

      select v.id as invoice_id, o.id as linked_order_id, 'numero_pedido'::text as link_method
      from valid v
      join public.olist_orders o
        on v.order_number is not null
       and o.numero_pedido = v.order_number
    ) links
    order by invoice_id,
      case link_method
        when 'order_id' then 1
        when 'ecommerce.numeroPedidoEcommerce' then 2
        when 'numeroOrdemCompra' then 3
        when 'ecommerce.numeroPedidoCanalVenda' then 4
        else 5
      end
  ),
  order_item_flags as (
    select
      mo.invoice_id,
      mo.linked_order_id,
      mo.link_method,
      count(oi.id)::bigint as item_rows,
      count(distinct nullif(oi.sku, ''))::bigint as sku_count,
      coalesce(sum(oi.quantidade), 0) as units,
      coalesce(sum(oi.valor_total), 0) as item_revenue
    from matched_orders mo
    join public.olist_order_items oi on oi.order_id = mo.linked_order_id
    group by mo.invoice_id, mo.linked_order_id, mo.link_method
  ),
  valid_with_links as (
    select
      v.*,
      coalesce(iif.item_rows, 0) > 0 as has_invoice_items,
      mo.linked_order_id,
      mo.link_method,
      oif.item_rows,
      oif.sku_count,
      oif.units,
      oif.item_revenue
    from valid v
    left join invoice_item_flags iif on iif.invoice_id = v.id
    left join matched_orders mo on mo.invoice_id = v.id
    left join order_item_flags oif on oif.invoice_id = v.id
  ),
  metrics as (
    select
      count(*)::bigint as total_valid_invoices,
      coalesce(sum(billed_revenue), 0) as total_valid_revenue,
      count(*) filter (where has_invoice_items)::bigint as invoices_with_invoice_items,
      coalesce(sum(billed_revenue) filter (where has_invoice_items), 0) as revenue_with_invoice_items,
      count(*) filter (where not has_invoice_items)::bigint as invoices_without_invoice_items,
      coalesce(sum(billed_revenue) filter (where not has_invoice_items), 0) as revenue_without_invoice_items,
      count(*) filter (where order_id is not null or order_number is not null)::bigint as invoices_with_order_reference,
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
  link_methods as (
    select
      link_method,
      count(*)::bigint as invoices
    from valid_with_links
    where linked_order_id is not null
    group by link_method
  ),
  invoice_skus as (
    select count(distinct nullif(ii.sku, ''))::bigint as distinct_invoice_item_skus
    from public.olist_invoice_items ii
    join valid v on v.id = ii.invoice_id
  ),
  order_skus as (
    select count(distinct nullif(oi.sku, ''))::bigint as distinct_order_item_skus
    from order_item_flags oif
    join public.olist_order_items oi on oi.order_id = oif.linked_order_id
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
        v.link_method,
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
    'link_methods', coalesce((select jsonb_agg(to_jsonb(link_methods.*) order by invoices desc) from link_methods), '[]'::jsonb),
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
