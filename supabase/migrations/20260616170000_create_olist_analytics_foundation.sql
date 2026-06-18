create table if not exists public.olist_order_items (
  id text primary key,
  order_id text not null references public.olist_orders (id) on delete cascade,
  line_number integer not null,
  produto_id text,
  sku text,
  tipo text,
  descricao text,
  quantidade numeric not null default 0,
  valor_unitario numeric,
  valor_total numeric,
  info_adicional text,
  order_data_criacao timestamptz,
  payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists olist_order_items_order_id_idx
  on public.olist_order_items (order_id);

create index if not exists olist_order_items_sku_idx
  on public.olist_order_items (sku);

create index if not exists olist_order_items_produto_id_idx
  on public.olist_order_items (produto_id);

create index if not exists olist_order_items_order_data_criacao_idx
  on public.olist_order_items (order_data_criacao desc);

alter table public.olist_order_items enable row level security;

create table if not exists public.olist_products (
  id text primary key,
  sku text,
  nome text,
  tipo text,
  situacao text,
  categoria_id text,
  categoria_nome text,
  marca_id text,
  marca_nome text,
  gtin text,
  preco numeric,
  preco_promocional numeric,
  preco_custo numeric,
  preco_custo_medio numeric,
  saldo numeric,
  reservado numeric,
  disponivel numeric,
  active boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists olist_products_sku_idx
  on public.olist_products (sku);

create index if not exists olist_products_categoria_nome_idx
  on public.olist_products (categoria_nome);

create index if not exists olist_products_marca_nome_idx
  on public.olist_products (marca_nome);

alter table public.olist_products enable row level security;

create table if not exists public.dim_channels (
  id text primary key,
  source text not null,
  source_id text,
  source_name text not null,
  display_name text not null,
  channel_group text,
  active boolean not null default true,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create unique index if not exists dim_channels_source_source_id_idx
  on public.dim_channels (source, source_id);

create unique index if not exists dim_channels_source_source_name_idx
  on public.dim_channels (source, source_name);

alter table public.dim_channels enable row level security;

create table if not exists public.dim_order_status (
  id text primary key,
  source text not null,
  code text not null,
  label text not null,
  funnel_stage text,
  sort_order integer not null default 999,
  is_canceled boolean not null default false,
  is_closed boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create unique index if not exists dim_order_status_source_code_idx
  on public.dim_order_status (source, code);

alter table public.dim_order_status enable row level security;

create table if not exists public.olist_stock_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  produto_id text,
  sku text,
  nome text,
  saldo numeric,
  reservado numeric,
  disponivel numeric,
  active boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists olist_stock_snapshots_snapshot_produto_idx
  on public.olist_stock_snapshots (snapshot_date, produto_id);

create index if not exists olist_stock_snapshots_snapshot_date_idx
  on public.olist_stock_snapshots (snapshot_date desc);

create index if not exists olist_stock_snapshots_sku_idx
  on public.olist_stock_snapshots (sku);

alter table public.olist_stock_snapshots enable row level security;
