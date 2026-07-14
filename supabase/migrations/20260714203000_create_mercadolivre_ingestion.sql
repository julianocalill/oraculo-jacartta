-- Ingestão analítica Mercado Livre Full (fase leitura).
-- Não altera mercadolivre_accounts/tokens/notifications nem métricas existentes.
-- Escrita exclusiva do service_role (edge function mercadolivre-sync);
-- leitura para authenticated seguindo a regra da migration 20260710094000
-- (grant + policy na tabela base, não apenas view).

create table if not exists public.mercadolivre_items (
  seller_id bigint not null references public.mercadolivre_accounts (seller_id) on delete cascade,
  mlb_id text not null,
  title text,
  sku text,
  status text,
  sub_status text,
  price numeric,
  permalink text,
  thumbnail text,
  logistic_type text,
  inventory_id text,
  available_qty integer not null default 0,
  full_stock integer not null default 0,
  sold_qty_30d integer not null default 0,
  revenue_30d numeric not null default 0,
  last_sale_at timestamptz,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (seller_id, mlb_id)
);

create index if not exists mercadolivre_items_logistic_idx
  on public.mercadolivre_items (seller_id, logistic_type);

create table if not exists public.mercadolivre_sales_daily (
  seller_id bigint not null,
  mlb_id text not null,
  sale_date date not null,
  qty_sold integer not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (seller_id, mlb_id, sale_date),
  foreign key (seller_id, mlb_id)
    references public.mercadolivre_items (seller_id, mlb_id) on delete cascade
);

create index if not exists mercadolivre_sales_daily_date_idx
  on public.mercadolivre_sales_daily (sale_date);

create table if not exists public.mercadolivre_inventory_snapshots (
  seller_id bigint not null,
  mlb_id text not null,
  snapshot_date date not null,
  full_stock integer not null default 0,
  available_qty integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (seller_id, mlb_id, snapshot_date),
  foreign key (seller_id, mlb_id)
    references public.mercadolivre_items (seller_id, mlb_id) on delete cascade
);

create index if not exists mercadolivre_inventory_snapshots_date_idx
  on public.mercadolivre_inventory_snapshots (snapshot_date);

create table if not exists public.mercadolivre_sync_runs (
  id uuid primary key default gen_random_uuid(),
  seller_id bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'failed')),
  items_count integer not null default 0,
  orders_count integer not null default 0,
  error_message text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists mercadolivre_sync_runs_started_at_idx
  on public.mercadolivre_sync_runs (started_at desc);

-- RLS: escrita somente service_role; leitura para authenticated (páginas web via RLS).
alter table public.mercadolivre_items enable row level security;
alter table public.mercadolivre_sales_daily enable row level security;
alter table public.mercadolivre_inventory_snapshots enable row level security;
alter table public.mercadolivre_sync_runs enable row level security;

revoke all on table public.mercadolivre_items from public, anon, authenticated;
revoke all on table public.mercadolivre_sales_daily from public, anon, authenticated;
revoke all on table public.mercadolivre_inventory_snapshots from public, anon, authenticated;
revoke all on table public.mercadolivre_sync_runs from public, anon, authenticated;

grant all on table public.mercadolivre_items to service_role;
grant all on table public.mercadolivre_sales_daily to service_role;
grant all on table public.mercadolivre_inventory_snapshots to service_role;
grant all on table public.mercadolivre_sync_runs to service_role;

grant select on table public.mercadolivre_items to authenticated;
grant select on table public.mercadolivre_sales_daily to authenticated;
grant select on table public.mercadolivre_inventory_snapshots to authenticated;
grant select on table public.mercadolivre_sync_runs to authenticated;

create policy mercadolivre_items_authenticated_read
  on public.mercadolivre_items for select to authenticated using (true);
create policy mercadolivre_sales_daily_authenticated_read
  on public.mercadolivre_sales_daily for select to authenticated using (true);
create policy mercadolivre_inventory_snapshots_authenticated_read
  on public.mercadolivre_inventory_snapshots for select to authenticated using (true);
create policy mercadolivre_sync_runs_authenticated_read
  on public.mercadolivre_sync_runs for select to authenticated using (true);

comment on table public.mercadolivre_items is
  'Cache do estado atual dos anúncios ML + agregados 30d. Escrita só via mercadolivre-sync.';
comment on table public.mercadolivre_sales_daily is
  'Série temporal de vendas por anúncio/dia (base p/ cobertura, evolução e elasticidade futura).';
comment on table public.mercadolivre_inventory_snapshots is
  'Snapshot diário de estoque Full por anúncio (idempotente por dia).';
comment on table public.mercadolivre_sync_runs is
  'Auditoria das execuções do mercadolivre-sync (padrão *_sync_runs do Olist).';
