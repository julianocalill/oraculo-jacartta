create table if not exists public.olist_order_items_backfill_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'partial', 'success', 'failed')),
  window_start date not null,
  window_end date not null,
  checkpoint_order_id text,
  candidates_total integer not null default 0,
  orders_processed integer not null default 0,
  orders_with_items integer not null default 0,
  orders_without_items integer not null default 0,
  orders_with_error integer not null default 0,
  items_upserted integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists olist_order_items_backfill_runs_window_idx
  on public.olist_order_items_backfill_runs (window_start, window_end, started_at desc);

alter table public.olist_order_items_backfill_runs enable row level security;

create table if not exists public.olist_order_items_backfill_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.olist_order_items_backfill_runs(id) on delete cascade,
  order_id text not null,
  invoice_id text,
  invoice_number text,
  status text not null default 'pending'
    check (status in ('pending', 'no_items', 'resolved')),
  attempt_count integer not null default 1,
  http_status integer,
  error_message text,
  context jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (run_id, order_id)
);

create index if not exists olist_order_items_backfill_errors_pending_idx
  on public.olist_order_items_backfill_errors (run_id, status, last_attempt_at);

alter table public.olist_order_items_backfill_errors enable row level security;

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
  select distinct on (orders.id)
    orders.id as order_id,
    orders.numero_pedido,
    orders.data_criacao as order_data_criacao,
    orders.payload as order_payload,
    invoices.id as invoice_id,
    invoices.invoice_number,
    invoices.issued_at,
    invoices.billed_revenue,
    invoices.order_number as marketplace_order_number
  from public.oraculo_fiscal_invoices_valid invoices
  join public.olist_orders orders
    on orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = invoices.order_number
  where invoices.issued_date between p_start_date and p_end_date
    and (p_after_order_id is null or orders.id > p_after_order_id)
    and not exists (
      select 1
      from public.olist_order_items items
      where items.order_id = orders.id
    )
  order by orders.id, invoices.issued_at, invoices.id
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
  select count(distinct orders.id)
  from public.oraculo_fiscal_invoices_valid invoices
  join public.olist_orders orders
    on orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = invoices.order_number
  where invoices.issued_date between p_start_date and p_end_date
    and not exists (
      select 1
      from public.olist_order_items items
      where items.order_id = orders.id
    );
$$;

revoke all on table public.olist_order_items_backfill_runs from anon, authenticated;
revoke all on table public.olist_order_items_backfill_errors from anon, authenticated;
grant all on table public.olist_order_items_backfill_runs to service_role;
grant all on table public.olist_order_items_backfill_errors to service_role;

revoke all on function public.oraculo_fiscal_order_item_backfill_candidates(date, date, text, integer) from public, anon, authenticated;
revoke all on function public.oraculo_fiscal_order_item_backfill_candidate_count(date, date) from public, anon, authenticated;
grant execute on function public.oraculo_fiscal_order_item_backfill_candidates(date, date, text, integer) to service_role;
grant execute on function public.oraculo_fiscal_order_item_backfill_candidate_count(date, date) to service_role;
