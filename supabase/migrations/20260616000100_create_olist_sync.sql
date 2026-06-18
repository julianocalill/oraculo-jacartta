create extension if not exists pgcrypto;

create table if not exists public.olist_orders (
  id text primary key,
  numero_pedido text,
  situacao text,
  data_criacao timestamptz,
  data_atualizacao timestamptz,
  cliente jsonb not null default '{}'::jsonb,
  transportador jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  synced_at timestamptz not null default now()
);

create index if not exists olist_orders_situacao_idx
  on public.olist_orders (situacao);

create index if not exists olist_orders_data_criacao_idx
  on public.olist_orders (data_criacao desc);

create index if not exists olist_orders_synced_at_idx
  on public.olist_orders (synced_at desc);

alter table public.olist_orders enable row level security;

create table if not exists public.olist_oauth_tokens (
  provider text primary key,
  access_token text,
  refresh_token text not null,
  expires_at timestamptz,
  scope text,
  token_type text,
  updated_at timestamptz not null default now()
);

alter table public.olist_oauth_tokens enable row level security;

create table if not exists public.olist_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  window_start date not null,
  window_end date not null,
  records_fetched integer not null default 0,
  records_upserted integer not null default 0,
  error_message text
);

create index if not exists olist_sync_runs_started_at_idx
  on public.olist_sync_runs (started_at desc);

alter table public.olist_sync_runs enable row level security;
