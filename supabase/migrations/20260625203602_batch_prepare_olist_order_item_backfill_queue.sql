create or replace function public.prepare_olist_order_item_backfill_queue_batch(
  p_start_date date,
  p_end_date date,
  p_after_order_id text default null,
  p_limit integer default 2000
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_inserted bigint := 0;
  v_next_order_id text;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Invalid backfill queue period: % to %', p_start_date, p_end_date;
  end if;

  with candidates as materialized (
    select distinct on (links.order_id)
      links.invoice_id,
      links.order_id,
      links.issued_date,
      links.billed_revenue,
      links.marketplace_order_number
    from public.oraculo_fiscal_invoice_order_links links
    where links.issued_date between p_start_date and p_end_date
      and links.order_id is not null
      and (p_after_order_id is null or links.order_id > p_after_order_id)
      and not exists (
        select 1
        from public.olist_order_items items
        where items.order_id = links.order_id
      )
    order by links.order_id, links.issued_date, links.invoice_id
    limit greatest(1, least(coalesce(p_limit, 2000), 5000))
  ),
  inserted as (
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
      invoices.invoice_number,
      candidates.order_id,
      coalesce(orders.numero_pedido, candidates.marketplace_order_number),
      invoices.emission_date,
      candidates.billed_revenue
    from candidates
    join public.olist_invoices invoices on invoices.id = candidates.invoice_id
    join public.olist_orders orders on orders.id = candidates.order_id
    on conflict (window_start, window_end, order_id) do nothing
    returning order_id
  )
  select
    count(*),
    max(order_id)
  into v_inserted, v_next_order_id
  from inserted;

  if v_next_order_id is null then
    select max(links.order_id)
    into v_next_order_id
    from (
      select distinct on (source.order_id)
        source.order_id
      from public.oraculo_fiscal_invoice_order_links source
      where source.issued_date between p_start_date and p_end_date
        and source.order_id is not null
        and (p_after_order_id is null or source.order_id > p_after_order_id)
        and not exists (
          select 1
          from public.olist_order_items items
          where items.order_id = source.order_id
        )
      order by source.order_id, source.issued_date, source.invoice_id
      limit greatest(1, least(coalesce(p_limit, 2000), 5000))
    ) links;
  end if;

  return jsonb_build_object(
    'inserted', v_inserted,
    'next_order_id', v_next_order_id,
    'exhausted', v_next_order_id is null
  );
end;
$$;

create or replace function public.olist_order_item_backfill_queue_summary(
  p_start_date date,
  p_end_date date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'window_start', p_start_date,
    'window_end', p_end_date,
    'total', count(*),
    'pending', count(*) filter (where processed_at is null and status = 'pending'),
    'completed', count(*) filter (where status = 'completed'),
    'no_items', count(*) filter (where status = 'no_items'),
    'error', count(*) filter (where status = 'error'),
    'last_order_id', max(order_id)
  )
  from public.olist_order_item_backfill_queue
  where window_start = p_start_date
    and window_end = p_end_date;
$$;

revoke all on function public.prepare_olist_order_item_backfill_queue_batch(date, date, text, integer) from public, anon, authenticated;
revoke all on function public.olist_order_item_backfill_queue_summary(date, date) from public, anon, authenticated;
grant execute on function public.prepare_olist_order_item_backfill_queue_batch(date, date, text, integer) to service_role;
grant execute on function public.olist_order_item_backfill_queue_summary(date, date) to service_role;
