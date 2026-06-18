create table if not exists public.olist_stock_items (
  id text primary key,
  produto_id text,
  sku text,
  nome text,
  saldo numeric,
  reservado numeric,
  disponivel numeric,
  depositos jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  active boolean not null default true,
  sync_batch_id uuid not null,
  synced_at timestamptz not null default now()
);

create index if not exists olist_stock_items_sku_idx
  on public.olist_stock_items (sku);

create index if not exists olist_stock_items_active_idx
  on public.olist_stock_items (active);

create index if not exists olist_stock_items_synced_at_idx
  on public.olist_stock_items (synced_at desc);

alter table public.olist_stock_items enable row level security;

create table if not exists public.olist_stock_sync_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  records_fetched integer not null default 0,
  records_upserted integer not null default 0,
  error_message text
);

create index if not exists olist_stock_sync_runs_started_at_idx
  on public.olist_stock_sync_runs (started_at desc);

alter table public.olist_stock_sync_runs enable row level security;
