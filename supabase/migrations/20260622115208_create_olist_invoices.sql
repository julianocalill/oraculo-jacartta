create table if not exists public.olist_invoices (
  id text primary key,
  invoice_number text,
  invoice_series text,
  emission_date timestamptz,
  cancellation_date timestamptz,
  status text,
  status_label text,
  client_name text,
  client_document text,
  uf text,
  total_amount numeric not null default 0,
  channel_name text,
  integration_name text,
  marketplace_name text,
  order_id text,
  order_number text,
  access_key text,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists olist_invoices_emission_date_idx
  on public.olist_invoices (emission_date desc);

create index if not exists olist_invoices_status_idx
  on public.olist_invoices (status);

create index if not exists olist_invoices_invoice_number_idx
  on public.olist_invoices (invoice_number);

create index if not exists olist_invoices_order_number_idx
  on public.olist_invoices (order_number);

create index if not exists olist_invoices_access_key_idx
  on public.olist_invoices (access_key);

alter table public.olist_invoices enable row level security;

create table if not exists public.olist_invoice_items (
  id text primary key,
  invoice_id text not null references public.olist_invoices(id) on delete cascade,
  line_number integer,
  product_id text,
  sku text,
  description text,
  quantity numeric not null default 0,
  unit_value numeric not null default 0,
  total_value numeric not null default 0,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists olist_invoice_items_invoice_id_idx
  on public.olist_invoice_items (invoice_id);

create index if not exists olist_invoice_items_sku_idx
  on public.olist_invoice_items (sku);

create index if not exists olist_invoice_items_product_id_idx
  on public.olist_invoice_items (product_id);

alter table public.olist_invoice_items enable row level security;

create table if not exists public.olist_invoice_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  endpoint text,
  window_start date,
  window_end date,
  records_fetched integer not null default 0,
  records_upserted integer not null default 0,
  items_upserted integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists olist_invoice_sync_runs_started_at_idx
  on public.olist_invoice_sync_runs (started_at desc);

alter table public.olist_invoice_sync_runs enable row level security;
