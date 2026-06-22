alter table public.olist_invoice_items
  add column if not exists invoice_number text;

create index if not exists olist_invoice_items_invoice_number_idx
  on public.olist_invoice_items (invoice_number);
