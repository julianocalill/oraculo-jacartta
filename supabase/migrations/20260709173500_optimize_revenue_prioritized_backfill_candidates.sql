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
  with prioritized_queue as materialized (
    select
      queue.id,
      queue.order_id,
      queue.invoice_id,
      queue.invoice_number,
      queue.issued_at,
      queue.total_amount,
      queue.order_number,
      queue.attempts
    from public.olist_order_item_backfill_queue queue
    where queue.window_start = p_start_date
      and queue.window_end = p_end_date
      and queue.processed_at is null
      and queue.status = 'pending'
    order by queue.total_amount desc, queue.issued_at asc, queue.id asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
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
  from prioritized_queue queue
  join public.olist_orders orders on orders.id = queue.order_id
  order by queue.total_amount desc, queue.issued_at asc, queue.id asc;
$$;

revoke all on function public.oraculo_fiscal_order_item_backfill_queue_candidates(date, date, integer) from public, anon, authenticated;
grant execute on function public.oraculo_fiscal_order_item_backfill_queue_candidates(date, date, integer) to service_role;
