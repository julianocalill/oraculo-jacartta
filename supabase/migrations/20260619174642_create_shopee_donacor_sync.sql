create table if not exists public.shopee_orders (
  id text primary key,
  shop_id bigint not null,
  shop_name text,
  order_sn text not null,
  order_status text,
  create_time timestamptz,
  update_time timestamptz,
  pay_time timestamptz,
  total_amount numeric,
  estimated_shipping_fee numeric,
  actual_shipping_fee numeric,
  currency text,
  buyer_user_id text,
  buyer_username text,
  recipient_name text,
  recipient_phone text,
  recipient_city text,
  recipient_state text,
  days_to_ship integer,
  note text,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create unique index if not exists shopee_orders_shop_order_sn_idx
  on public.shopee_orders (shop_id, order_sn);

create index if not exists shopee_orders_create_time_idx
  on public.shopee_orders (create_time desc);

create index if not exists shopee_orders_status_idx
  on public.shopee_orders (order_status);

alter table public.shopee_orders enable row level security;

create table if not exists public.shopee_order_items (
  id text primary key,
  order_id text not null references public.shopee_orders (id) on delete cascade,
  shop_id bigint not null,
  order_sn text not null,
  item_id text,
  item_name text,
  model_id text,
  model_name text,
  sku text,
  quantity integer not null default 0,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists shopee_order_items_order_id_idx
  on public.shopee_order_items (order_id);

create index if not exists shopee_order_items_item_id_idx
  on public.shopee_order_items (item_id);

create index if not exists shopee_order_items_sku_idx
  on public.shopee_order_items (sku);

alter table public.shopee_order_items enable row level security;

create table if not exists public.shopee_products (
  id text primary key,
  shop_id bigint not null,
  item_id text not null,
  model_id text,
  item_name text,
  item_sku text,
  item_status text,
  category_id text,
  brand_name text,
  price_min numeric,
  price_max numeric,
  stock_total numeric,
  weight numeric,
  create_time timestamptz,
  update_time timestamptz,
  image_url text,
  model_name text,
  model_sku text,
  model_status text,
  model_stock numeric,
  model_price numeric,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create unique index if not exists shopee_products_shop_item_model_idx
  on public.shopee_products (shop_id, item_id, coalesce(model_id, ''));

create index if not exists shopee_products_item_status_idx
  on public.shopee_products (item_status);

create index if not exists shopee_products_item_sku_idx
  on public.shopee_products (item_sku);

alter table public.shopee_products enable row level security;

create table if not exists public.shopee_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  records_fetched integer not null default 0,
  records_upserted integer not null default 0,
  error_message text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists shopee_sync_runs_source_started_at_idx
  on public.shopee_sync_runs (source, started_at desc);

alter table public.shopee_sync_runs enable row level security;
