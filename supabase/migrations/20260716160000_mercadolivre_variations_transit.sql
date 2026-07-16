-- Pacote 5-8 do estudo Magiic:
-- #6 Variações (ruptura acontece por variação/SKU, não por anúncio) +
--    vendas diárias por variação (habilita velocidade própria e o match de
--    SKU com o custo Olist, já que só 20/1930 anúncios têm SKU no nível pai).
-- #7 Estoque em trânsito para o Full (informado manualmente; soma na
--    cobertura como a Magiic faz).

create table if not exists public.mercadolivre_variations (
  seller_id bigint not null,
  mlb_id text not null,
  variation_id text not null,
  sku text,
  attrs text, -- ex: "Cor: Azul · Tamanho: M"
  price numeric,
  available_qty integer not null default 0,
  full_stock integer not null default 0,
  inventory_id text,
  sold_qty_30d integer not null default 0,
  revenue_30d numeric not null default 0,
  sold_qty_60d integer not null default 0,
  revenue_60d numeric not null default 0,
  last_sale_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (seller_id, mlb_id, variation_id),
  foreign key (seller_id, mlb_id)
    references public.mercadolivre_items (seller_id, mlb_id) on delete cascade
);

create index if not exists mercadolivre_variations_sku_idx
  on public.mercadolivre_variations (sku);

create table if not exists public.mercadolivre_variation_sales_daily (
  seller_id bigint not null,
  mlb_id text not null,
  variation_id text not null,
  sale_date date not null,
  qty_sold integer not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (seller_id, mlb_id, variation_id, sale_date)
);

create index if not exists mercadolivre_variation_sales_daily_date_idx
  on public.mercadolivre_variation_sales_daily (sale_date);

create table if not exists public.mercadolivre_transit (
  seller_id bigint not null,
  mlb_id text not null,
  qty integer not null default 0,
  note text,
  updated_at timestamptz not null default now(),
  primary key (seller_id, mlb_id)
);

-- RLS no padrão do canal: escrita service_role, leitura authenticated
alter table public.mercadolivre_variations enable row level security;
alter table public.mercadolivre_variation_sales_daily enable row level security;
alter table public.mercadolivre_transit enable row level security;

revoke all on table public.mercadolivre_variations from public, anon, authenticated;
revoke all on table public.mercadolivre_variation_sales_daily from public, anon, authenticated;
revoke all on table public.mercadolivre_transit from public, anon, authenticated;

grant all on table public.mercadolivre_variations to service_role;
grant all on table public.mercadolivre_variation_sales_daily to service_role;
grant all on table public.mercadolivre_transit to service_role;

grant select on table public.mercadolivre_variations to authenticated;
grant select on table public.mercadolivre_variation_sales_daily to authenticated;
grant select on table public.mercadolivre_transit to authenticated;

create policy mercadolivre_variations_authenticated_read
  on public.mercadolivre_variations for select to authenticated using (true);
create policy mercadolivre_variation_sales_daily_authenticated_read
  on public.mercadolivre_variation_sales_daily for select to authenticated using (true);
create policy mercadolivre_transit_authenticated_read
  on public.mercadolivre_transit for select to authenticated using (true);

-- RPC v3: além dos agregados do anúncio, recalcula os das variações
create or replace function public.mercadolivre_refresh_item_aggregates(p_seller_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mercadolivre_items
     set sold_qty_30d = 0, revenue_30d = 0, sold_qty_60d = 0, revenue_60d = 0
   where seller_id = p_seller_id;

  update public.mercadolivre_items i
     set sold_qty_30d = s.q30, revenue_30d = s.r30,
         sold_qty_60d = s.q60, revenue_60d = s.r60,
         last_sale_at = greatest(coalesce(i.last_sale_at, s.last_sale), s.last_sale)
    from (
      select mlb_id,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 29), 0) as q30,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 29), 0) as r30,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 59), 0) as q60,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 59), 0) as r60,
             (max(sale_date) filter (where qty_sold > 0))::timestamptz as last_sale
        from public.mercadolivre_sales_daily
       where seller_id = p_seller_id
       group by mlb_id
    ) s
   where i.seller_id = p_seller_id and i.mlb_id = s.mlb_id;

  update public.mercadolivre_items i
     set snapshot_days_30d = t.obs, in_stock_days_30d = t.instock
    from (
      select s.mlb_id,
             count(*) as obs,
             count(*) filter (
               where case
                 when i2.logistic_type = 'fulfillment' then s.full_stock > 0
                 else s.available_qty > 0
               end
             ) as instock
        from public.mercadolivre_inventory_snapshots s
        join public.mercadolivre_items i2
          on i2.seller_id = s.seller_id and i2.mlb_id = s.mlb_id
       where s.seller_id = p_seller_id
         and s.snapshot_date >= current_date - 29
       group by s.mlb_id
    ) t
   where i.seller_id = p_seller_id and i.mlb_id = t.mlb_id;

  -- variações
  update public.mercadolivre_variations
     set sold_qty_30d = 0, revenue_30d = 0, sold_qty_60d = 0, revenue_60d = 0
   where seller_id = p_seller_id;

  update public.mercadolivre_variations v
     set sold_qty_30d = s.q30, revenue_30d = s.r30,
         sold_qty_60d = s.q60, revenue_60d = s.r60,
         last_sale_at = greatest(coalesce(v.last_sale_at, s.last_sale), s.last_sale)
    from (
      select mlb_id, variation_id,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 29), 0) as q30,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 29), 0) as r30,
             coalesce(sum(qty_sold) filter (where sale_date >= current_date - 59), 0) as q60,
             coalesce(sum(revenue) filter (where sale_date >= current_date - 59), 0) as r60,
             (max(sale_date) filter (where qty_sold > 0))::timestamptz as last_sale
        from public.mercadolivre_variation_sales_daily
       where seller_id = p_seller_id
       group by mlb_id, variation_id
    ) s
   where v.seller_id = p_seller_id
     and v.mlb_id = s.mlb_id
     and v.variation_id = s.variation_id;
end;
$$;

revoke all on function public.mercadolivre_refresh_item_aggregates(bigint) from public, anon, authenticated;
grant execute on function public.mercadolivre_refresh_item_aggregates(bigint) to service_role;
