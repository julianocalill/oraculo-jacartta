create table if not exists public.olist_order_item_backfill_queue (
  id bigint generated always as identity primary key,
  window_start date not null,
  window_end date not null,
  invoice_id text not null references public.olist_invoices(id) on delete cascade,
  invoice_number text,
  order_id text not null references public.olist_orders(id) on delete cascade,
  order_number text,
  issued_at timestamptz not null,
  total_amount numeric not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'no_items', 'error')),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (window_start, window_end, order_id)
);

create index if not exists olist_order_item_backfill_queue_processed_id_idx
  on public.olist_order_item_backfill_queue (processed_at, id);

create index if not exists olist_order_item_backfill_queue_pending_idx
  on public.olist_order_item_backfill_queue (window_start, window_end, id)
  where processed_at is null and status = 'pending';

create index if not exists olist_order_item_backfill_queue_order_id_idx
  on public.olist_order_item_backfill_queue (order_id);

create index if not exists olist_order_items_order_id_idx
  on public.olist_order_items (order_id);

alter table public.olist_order_item_backfill_queue enable row level security;

create or replace function public.prepare_olist_order_item_backfill_queue(
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reconciled bigint := 0;
  v_inserted bigint := 0;
  v_pending bigint := 0;
  v_total bigint := 0;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Invalid backfill queue period: % to %', p_start_date, p_end_date;
  end if;

  update public.olist_order_item_backfill_queue queue
  set
    status = 'completed',
    processed_at = coalesce(queue.processed_at, now()),
    last_error = null,
    updated_at = now()
  where queue.window_start = p_start_date
    and queue.window_end = p_end_date
    and queue.processed_at is null
    and exists (
      select 1
      from public.olist_order_items items
      where items.order_id = queue.order_id
    );
  get diagnostics v_reconciled = row_count;

  with candidates as materialized (
    select distinct on (links.order_id)
      links.invoice_id,
      invoices.invoice_number,
      links.order_id,
      coalesce(orders.numero_pedido, links.marketplace_order_number) as order_number,
      invoices.emission_date as issued_at,
      links.billed_revenue as total_amount
    from public.oraculo_fiscal_invoice_order_links links
    join public.olist_invoices invoices on invoices.id = links.invoice_id
    join public.olist_orders orders on orders.id = links.order_id
    where links.issued_date between p_start_date and p_end_date
      and links.order_id is not null
      and not exists (
        select 1
        from public.olist_order_items items
        where items.order_id = links.order_id
      )
    order by links.order_id, invoices.emission_date, links.invoice_id
  )
  insert into public.olist_order_item_backfill_queue (
    window_start,
    window_end,
    invoice_id,
    invoice_number,
    order_id,
    order_number,
    issued_at,
    total_amount
  )
  select
    p_start_date,
    p_end_date,
    candidates.invoice_id,
    candidates.invoice_number,
    candidates.order_id,
    candidates.order_number,
    candidates.issued_at,
    candidates.total_amount
  from candidates
  on conflict (window_start, window_end, order_id) do nothing;
  get diagnostics v_inserted = row_count;

  select
    count(*) filter (where processed_at is null and status = 'pending'),
    count(*)
  into v_pending, v_total
  from public.olist_order_item_backfill_queue
  where window_start = p_start_date
    and window_end = p_end_date;

  return jsonb_build_object(
    'window_start', p_start_date,
    'window_end', p_end_date,
    'reconciled_existing_items', v_reconciled,
    'inserted', v_inserted,
    'pending', v_pending,
    'total', v_total
  );
end;
$$;

create or replace function public.oraculo_fiscal_order_item_backfill_queue_candidates(
  p_start_date date,
  p_end_date date,
  p_limit integer default 100
)
returns table (
  queue_id bigint,
  order_id text,
  numero_pedido text,
  order_data_criacao timestamptz,
  order_payload jsonb,
  invoice_id text,
  invoice_number text,
  issued_at timestamptz,
  billed_revenue numeric,
  marketplace_order_number text,
  attempts integer
)
language sql
stable
set search_path = public
as $$
  select
    queue.id as queue_id,
    queue.order_id,
    orders.numero_pedido,
    orders.data_criacao as order_data_criacao,
    orders.payload as order_payload,
    queue.invoice_id,
    queue.invoice_number,
    queue.issued_at,
    queue.total_amount as billed_revenue,
    queue.order_number as marketplace_order_number,
    queue.attempts
  from public.olist_order_item_backfill_queue queue
  join public.olist_orders orders on orders.id = queue.order_id
  where queue.window_start = p_start_date
    and queue.window_end = p_end_date
    and queue.processed_at is null
    and queue.status = 'pending'
  order by queue.id
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

create or replace function public.mark_olist_order_item_backfill_queue(
  p_queue_id bigint,
  p_status text,
  p_last_error text default null
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_status not in ('completed', 'no_items', 'error') then
    raise exception 'Invalid queue status: %', p_status;
  end if;

  update public.olist_order_item_backfill_queue
  set
    status = p_status,
    processed_at = case when p_status in ('completed', 'no_items') then now() else null end,
    attempts = attempts + 1,
    last_error = nullif(p_last_error, ''),
    updated_at = now()
  where id = p_queue_id;
end;
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
  select count(*)
  from public.olist_order_item_backfill_queue queue
  where queue.window_start = p_start_date
    and queue.window_end = p_end_date
    and queue.processed_at is null
    and queue.status = 'pending';
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
  select
    queue.order_id,
    orders.numero_pedido,
    orders.data_criacao as order_data_criacao,
    orders.payload as order_payload,
    queue.invoice_id,
    queue.invoice_number,
    queue.issued_at,
    queue.total_amount as billed_revenue,
    queue.order_number as marketplace_order_number
  from public.olist_order_item_backfill_queue queue
  join public.olist_orders orders on orders.id = queue.order_id
  where queue.window_start = p_start_date
    and queue.window_end = p_end_date
    and queue.processed_at is null
    and queue.status = 'pending'
    and (p_after_order_id is null or queue.order_id > p_after_order_id)
  order by queue.id
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

revoke all on table public.olist_order_item_backfill_queue from public, anon, authenticated;
grant all on table public.olist_order_item_backfill_queue to service_role;

revoke all on function public.prepare_olist_order_item_backfill_queue(date, date) from public, anon, authenticated;
revoke all on function public.oraculo_fiscal_order_item_backfill_queue_candidates(date, date, integer) from public, anon, authenticated;
revoke all on function public.mark_olist_order_item_backfill_queue(bigint, text, text) from public, anon, authenticated;
revoke all on function public.oraculo_fiscal_order_item_backfill_candidate_count(date, date) from public, anon, authenticated;
revoke all on function public.oraculo_fiscal_order_item_backfill_candidates(date, date, text, integer) from public, anon, authenticated;

grant execute on function public.prepare_olist_order_item_backfill_queue(date, date) to service_role;
grant execute on function public.oraculo_fiscal_order_item_backfill_queue_candidates(date, date, integer) to service_role;
grant execute on function public.mark_olist_order_item_backfill_queue(bigint, text, text) to service_role;
grant execute on function public.oraculo_fiscal_order_item_backfill_candidate_count(date, date) to service_role;
grant execute on function public.oraculo_fiscal_order_item_backfill_candidates(date, date, text, integer) to service_role;
