create or replace function public.complete_olist_order_item_backfill_queue_from_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.olist_order_item_backfill_queue queue
  set
    status = 'completed',
    processed_at = coalesce(queue.processed_at, now()),
    attempts = greatest(queue.attempts, 1),
    last_error = null,
    updated_at = now()
  where queue.order_id = new.order_id
    and queue.processed_at is null
    and queue.status = 'pending';

  return new;
end;
$$;

drop trigger if exists complete_olist_order_item_backfill_queue_from_item
  on public.olist_order_items;

create trigger complete_olist_order_item_backfill_queue_from_item
after insert or update of order_id on public.olist_order_items
for each row
execute function public.complete_olist_order_item_backfill_queue_from_item();

revoke all on function public.complete_olist_order_item_backfill_queue_from_item() from public, anon, authenticated;
