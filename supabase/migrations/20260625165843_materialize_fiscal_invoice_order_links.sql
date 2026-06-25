create table if not exists public.oraculo_fiscal_invoice_order_links (
  invoice_id text primary key references public.olist_invoices(id) on delete cascade,
  order_id text not null references public.olist_orders(id) on delete cascade,
  issued_date date not null,
  billed_revenue numeric not null default 0,
  marketplace_order_number text,
  link_method text not null default 'ecommerce.numeroPedidoEcommerce',
  refreshed_at timestamptz not null default now()
);

create index if not exists oraculo_fiscal_invoice_order_links_order_idx
  on public.oraculo_fiscal_invoice_order_links (order_id);

create index if not exists oraculo_fiscal_invoice_order_links_date_idx
  on public.oraculo_fiscal_invoice_order_links (issued_date, order_id);

alter table public.oraculo_fiscal_invoice_order_links enable row level security;

insert into public.oraculo_fiscal_invoice_order_links (
  invoice_id,
  order_id,
  issued_date,
  billed_revenue,
  marketplace_order_number,
  refreshed_at
)
select distinct on (invoices.id)
  invoices.id,
  orders.id,
  invoices.issued_date,
  invoices.billed_revenue,
  invoices.order_number,
  now()
from public.oraculo_fiscal_invoices_valid invoices
join public.olist_orders orders
  on orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = invoices.order_number
order by
  invoices.id,
  orders.synced_at desc,
  orders.data_criacao desc nulls last,
  orders.id desc
on conflict (invoice_id) do update
set
  order_id = excluded.order_id,
  issued_date = excluded.issued_date,
  billed_revenue = excluded.billed_revenue,
  marketplace_order_number = excluded.marketplace_order_number,
  refreshed_at = excluded.refreshed_at;

create or replace function public.refresh_oraculo_fiscal_invoice_order_links(
  p_start_date date,
  p_end_date date
)
returns bigint
language sql
set search_path = public
as $$
  with matches as (
    select distinct on (invoices.id)
      invoices.id as invoice_id,
      orders.id as order_id,
      invoices.issued_date,
      invoices.billed_revenue,
      invoices.order_number as marketplace_order_number
    from public.oraculo_fiscal_invoices_valid invoices
    left join public.oraculo_fiscal_invoice_order_links existing
      on existing.invoice_id = invoices.id
    join public.olist_orders orders
      on orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = invoices.order_number
    where invoices.issued_date between p_start_date and p_end_date
      and existing.invoice_id is null
    order by
      invoices.id,
      orders.synced_at desc,
      orders.data_criacao desc nulls last,
      orders.id desc
  ),
  upserted as (
    insert into public.oraculo_fiscal_invoice_order_links (
      invoice_id,
      order_id,
      issued_date,
      billed_revenue,
      marketplace_order_number,
      refreshed_at
    )
    select
      matches.invoice_id,
      matches.order_id,
      matches.issued_date,
      matches.billed_revenue,
      matches.marketplace_order_number,
      now()
    from matches
    on conflict (invoice_id) do update
    set
      order_id = excluded.order_id,
      issued_date = excluded.issued_date,
      billed_revenue = excluded.billed_revenue,
      marketplace_order_number = excluded.marketplace_order_number,
      refreshed_at = excluded.refreshed_at
    returning 1
  )
  select count(*)::bigint from upserted;
$$;

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
  with unique_orders as (
    select distinct on (links.order_id)
      links.order_id,
      orders.numero_pedido,
      orders.data_criacao as order_data_criacao,
      orders.payload as order_payload,
      invoices.id as invoice_id,
      invoices.invoice_number,
      invoices.issued_at,
      links.billed_revenue,
      links.marketplace_order_number
    from public.oraculo_fiscal_invoice_order_links links
    join public.oraculo_fiscal_invoices_valid invoices on invoices.id = links.invoice_id
    join public.olist_orders orders on orders.id = links.order_id
    where links.issued_date between p_start_date and p_end_date
      and (p_after_order_id is null or links.order_id > p_after_order_id)
      and not exists (
        select 1
        from public.olist_order_items items
        where items.order_id = links.order_id
      )
    order by links.order_id, invoices.issued_at, invoices.id
  )
  select *
  from unique_orders
  order by order_id
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
  select count(distinct links.order_id)
  from public.oraculo_fiscal_invoice_order_links links
  where links.issued_date between p_start_date and p_end_date
    and not exists (
      select 1
      from public.olist_order_items items
      where items.order_id = links.order_id
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
  with valid as (
    select id, billed_revenue
    from public.oraculo_fiscal_invoices_valid
    where issued_date between p_start_date and p_end_date
  ),
  coverage as (
    select
      valid.id as invoice_id,
      valid.billed_revenue,
      links.order_id,
      exists (
        select 1
        from public.olist_order_items items
        where items.order_id = links.order_id
      ) as has_order_items
    from valid
    left join public.oraculo_fiscal_invoice_order_links links on links.invoice_id = valid.id
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
    from (
      select distinct order_id
      from coverage
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

revoke all on table public.oraculo_fiscal_invoice_order_links from anon, authenticated;
grant all on table public.oraculo_fiscal_invoice_order_links to service_role;
revoke all on function public.refresh_oraculo_fiscal_invoice_order_links(date, date) from public, anon, authenticated;
grant execute on function public.refresh_oraculo_fiscal_invoice_order_links(date, date) to service_role;
