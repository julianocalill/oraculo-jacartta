-- Analítica de estoque do canal Shopee (espelho do modelo Mercado Livre):
-- inventário FBS por armazém (módulo SBS), série de vendas diárias derivada
-- dos pedidos já ingeridos, snapshots e agregados por produto.
-- As 4 lojas estão inscritas no FBS (sonda 2026-07-16); Oliverhome já opera.

-- Inventário FBS (SBS) por SKU × armazém — a Shopee entrega velocidade,
-- cobertura, janelas de venda e trânsito prontos.
create table if not exists public.shopee_sbs_inventory (
  id text primary key, -- `${shop_id}-${whs_id}-${item_id}-${model_id||0}`
  shop_id bigint not null,
  whs_id text not null,
  item_id text not null,
  model_id text,
  mtsku_id text,
  item_name text,
  model_name text,
  shop_item_id text,
  shop_model_id text,
  sellable_qty integer not null default 0,
  reserved_qty integer not null default 0,
  unsellable_qty integer not null default 0,
  in_transit_qty integer not null default 0,
  excess_stock integer not null default 0,
  coverage_days numeric,
  in_whs_coverage_days numeric,
  selling_speed numeric not null default 0,
  last_7_sold integer not null default 0,
  last_15_sold integer not null default 0,
  last_30_sold integer not null default 0,
  last_60_sold integer not null default 0,
  last_90_sold integer not null default 0,
  stock_level integer,
  not_moving_tag integer,
  raw_json jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists shopee_sbs_inventory_shop_idx
  on public.shopee_sbs_inventory (shop_id, whs_id);

create table if not exists public.shopee_sbs_snapshots (
  shop_id bigint not null,
  whs_id text not null,
  item_id text not null,
  model_id text not null default '0',
  snapshot_date date not null,
  sellable_qty integer not null default 0,
  in_transit_qty integer not null default 0,
  selling_speed numeric not null default 0,
  created_at timestamptz not null default now(),
  primary key (shop_id, whs_id, item_id, model_id, snapshot_date)
);

-- Snapshot diário do estoque local dos anúncios (base dias-com-estoque)
create table if not exists public.shopee_product_snapshots (
  shop_id bigint not null,
  item_id text not null,
  model_id text not null default '0',
  snapshot_date date not null,
  stock integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (shop_id, item_id, model_id, snapshot_date)
);

-- Série diária de vendas derivada de shopee_orders/shopee_order_items
create table if not exists public.shopee_sales_daily (
  shop_id bigint not null,
  item_id text not null,
  model_id text not null default '0',
  sku text,
  sale_date date not null,
  qty_sold integer not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (shop_id, item_id, model_id, sale_date)
);

create index if not exists shopee_sales_daily_date_idx
  on public.shopee_sales_daily (sale_date);

-- Agregados por produto (janelas), preenchidos pelo RPC
alter table public.shopee_products
  add column if not exists sold_qty_30d integer not null default 0,
  add column if not exists revenue_30d numeric not null default 0,
  add column if not exists sold_qty_60d integer not null default 0,
  add column if not exists revenue_60d numeric not null default 0,
  add column if not exists last_sale_at timestamptz;

-- Reconstrói a série de vendas a partir dos pedidos (idempotente; pedidos
-- cancelados/não pagos ficam fora). Revenue extraída do raw_json do item.
create or replace function public.shopee_refresh_sales_daily()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.shopee_sales_daily;
  insert into public.shopee_sales_daily
    (shop_id, item_id, model_id, sku, sale_date, qty_sold, revenue, updated_at)
  select
    oi.shop_id,
    oi.item_id,
    coalesce(nullif(oi.model_id, ''), '0'),
    max(nullif(oi.sku, '')),
    (o.create_time at time zone 'America/Sao_Paulo')::date,
    sum(coalesce(oi.quantity, 0)),
    sum(coalesce(oi.quantity, 0) * coalesce(
      nullif(oi.raw_json->>'model_discounted_price', '')::numeric,
      nullif(oi.raw_json->>'model_original_price', '')::numeric,
      0
    )),
    now()
  from public.shopee_order_items oi
  join public.shopee_orders o on o.id = oi.order_id
  where oi.item_id is not null
    and coalesce(o.order_status, '') not in ('CANCELLED', 'IN_CANCEL', 'UNPAID')
  group by oi.shop_id, oi.item_id, coalesce(nullif(oi.model_id, ''), '0'),
           (o.create_time at time zone 'America/Sao_Paulo')::date;
end;
$$;

-- Janelas 30/60d por produto (modelo) a partir da série
create or replace function public.shopee_refresh_product_aggregates()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shopee_products
     set sold_qty_30d = 0, revenue_30d = 0, sold_qty_60d = 0, revenue_60d = 0;

  update public.shopee_products p
     set sold_qty_30d = s.q30,
         revenue_30d = s.r30,
         sold_qty_60d = s.q60,
         revenue_60d = s.r60,
         last_sale_at = greatest(coalesce(p.last_sale_at, s.last_sale), s.last_sale)
    from (
      select shop_id, item_id, model_id,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 29), 0) as q30,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 29), 0) as r30,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 59), 0) as q60,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 59), 0) as r60,
             (max(sale_date) filter (where qty_sold > 0))::timestamptz as last_sale
        from public.shopee_sales_daily
       group by shop_id, item_id, model_id
    ) s
   where p.shop_id = s.shop_id
     and p.item_id = s.item_id
     and coalesce(nullif(p.model_id, ''), '0') = s.model_id;
end;
$$;

-- RLS: escrita service_role; leitura authenticated (páginas web)
alter table public.shopee_sbs_inventory enable row level security;
alter table public.shopee_sbs_snapshots enable row level security;
alter table public.shopee_product_snapshots enable row level security;
alter table public.shopee_sales_daily enable row level security;

revoke all on table public.shopee_sbs_inventory from public, anon, authenticated;
revoke all on table public.shopee_sbs_snapshots from public, anon, authenticated;
revoke all on table public.shopee_product_snapshots from public, anon, authenticated;
revoke all on table public.shopee_sales_daily from public, anon, authenticated;

grant all on table public.shopee_sbs_inventory to service_role;
grant all on table public.shopee_sbs_snapshots to service_role;
grant all on table public.shopee_product_snapshots to service_role;
grant all on table public.shopee_sales_daily to service_role;

grant select on table public.shopee_sbs_inventory to authenticated;
grant select on table public.shopee_sbs_snapshots to authenticated;
grant select on table public.shopee_product_snapshots to authenticated;
grant select on table public.shopee_sales_daily to authenticated;

create policy shopee_sbs_inventory_authenticated_read
  on public.shopee_sbs_inventory for select to authenticated using (true);
create policy shopee_sbs_snapshots_authenticated_read
  on public.shopee_sbs_snapshots for select to authenticated using (true);
create policy shopee_product_snapshots_authenticated_read
  on public.shopee_product_snapshots for select to authenticated using (true);
create policy shopee_sales_daily_authenticated_read
  on public.shopee_sales_daily for select to authenticated using (true);

-- shopee_products passa a ser lida pelas páginas (grant + policy idempotentes)
grant select on table public.shopee_products to authenticated;
do $$
begin
  create policy shopee_products_authenticated_read
    on public.shopee_products for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

revoke all on function public.shopee_refresh_sales_daily() from public, anon, authenticated;
revoke all on function public.shopee_refresh_product_aggregates() from public, anon, authenticated;
grant execute on function public.shopee_refresh_sales_daily() to service_role;
grant execute on function public.shopee_refresh_product_aggregates() to service_role;
