-- Análise Preço × Produto Shopee dentro do Oráculo (aba /shopee/precos),
-- atualizada de hora em hora. Internaliza a planilha "Análise Preço-Produto"
-- de 16/08 (analises/preco-produto-shopee-2026-08/): para cada anúncio/variação
-- ativa das 4 lojas, resolve o SKU Olist (de-para por pedidos casados), o custo
-- pela regra do Juliano (anúncio de KIT → valor da aba de kits da Olist =
-- custo médio do componente; produto unitário → preço de custo do cadastro),
-- o lucro/prejuízo pela fórmula dele e a checagem de conflito de modelo.
--
-- Pipeline: edge function shopee-price-product-refresh (cron :57) lê os pares
-- via RPC daqui + espelhos (shopee_products, olist_products) e grava o cache.
-- Grade de cron: :57 tinha só o backfill overnight (3-8h) — fica em ≤2 jobs.
-- Os 4 syncs de produtos Shopee passam de 4×/dia para HORÁRIOS (mesmos minutos
-- 22/32/44/52, que só tinham o bip-fulfillment) — sem eles o preço do cache
-- envelheceria 6h e a análise horária seria teatro.

-- 1) Cache -------------------------------------------------------------------

create table if not exists public.oraculo_shopee_price_product_cache (
  shop_id bigint not null,
  shop_name text,
  item_id text not null,
  model_id text not null default '0',
  item_name text,
  model_name text,
  channel_sku text,               -- SKU do vendedor no anúncio
  item_status text,
  price numeric,                  -- preço atual (promo inclusa) do sync de produtos
  sku_olist text,
  olist_product_name text,
  qtd integer,                    -- unidades Olist por unidade do anúncio
  unit_cost numeric,              -- regra kit/unitário
  cost_total numeric,             -- qtd × unit_cost
  profit_unit numeric,            -- fórmula do Juliano por unidade vendida
  origem text,                    -- venda casada (N) / SKU do de-para / herdado... + ressalvas
  pedidos integer,                -- evidência do vínculo
  checagem text,                  -- 'ok' | '⚠ ...' (modelo/volume/peso/evidência fraca)
  refreshed_at timestamptz not null default now(),
  primary key (shop_id, item_id, model_id)
);

create index if not exists oraculo_shopee_price_product_profit_idx
  on public.oraculo_shopee_price_product_cache (profit_unit);
create index if not exists oraculo_shopee_price_product_shop_idx
  on public.oraculo_shopee_price_product_cache (shop_id);

alter table public.oraculo_shopee_price_product_cache enable row level security;
revoke all on table public.oraculo_shopee_price_product_cache from public, anon, authenticated;
grant all on table public.oraculo_shopee_price_product_cache to service_role;

comment on table public.oraculo_shopee_price_product_cache is
  'Preço × custo × lucro por anúncio/variação Shopee. Recalculado de hora em hora (cron :57) pela edge function shopee-price-product-refresh.';

create table if not exists public.oraculo_shopee_price_product_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','failed')),
  rows_written integer not null default 0,
  error_message text
);

alter table public.oraculo_shopee_price_product_runs enable row level security;
revoke all on table public.oraculo_shopee_price_product_runs from public, anon, authenticated;
grant all on table public.oraculo_shopee_price_product_runs to service_role;

-- 2) RPC: pares (item_id, model_id) → SKU Olist por pedidos casados ----------
-- Mesma derivação validada na planilha de 16/08 (scripts/01-derivar-de-para.sql).

create or replace function public.oraculo_shopee_item_model_pairs()
returns table (
  item_id text,
  model_id text,
  sku_olist text,
  orders_matched bigint,
  orders_total bigint,
  qty_ratio numeric,
  rk bigint
)
language sql
security definer
set search_path = public
set statement_timeout to '120s'
as $$
  with olist_side as (
    select c.order_ref,
           min(ii.sku)      as sku_olist,
           sum(ii.quantity) as qty_olist
      from oraculo_olist_order_ref_cache c
      join olist_invoice_items ii on ii.invoice_id = c.invoice_id
     where c.order_ref is not null
       and c.channel_label ilike '%shopee%'
       and nullif(ii.sku,'') is not null
     group by c.order_ref
    having count(distinct ii.sku) = 1
  ),
  shopee_side as (
    select oi.order_sn,
           min(oi.item_id) as item_id,
           min(coalesce(oi.model_id,'')) as model_id,
           sum(oi.quantity) as qty_channel
      from shopee_order_items oi
     group by oi.order_sn
    having count(distinct (oi.item_id, coalesce(oi.model_id,''))) = 1
  ),
  pairs as (
    select s.item_id, s.model_id, o.sku_olist,
           count(*) as orders_matched,
           round(avg(o.qty_olist/nullif(s.qty_channel,0))::numeric, 2) as qty_ratio
      from shopee_side s
      join olist_side o on o.order_ref = s.order_sn
     group by s.item_id, s.model_id, o.sku_olist
  )
  select p.item_id,
         coalesce(nullif(p.model_id,''),'0'),
         p.sku_olist, p.orders_matched,
         sum(p.orders_matched) over (partition by p.item_id, p.model_id) as orders_total,
         p.qty_ratio,
         row_number() over (partition by p.item_id, p.model_id order by p.orders_matched desc) as rk
    from pairs p
$$;

revoke all on function public.oraculo_shopee_item_model_pairs() from public, anon, authenticated;
grant execute on function public.oraculo_shopee_item_model_pairs() to service_role;

-- 3) Cron: produtos Shopee horários + refresh do cache às :57 ----------------

do $$
begin
  perform cron.unschedule('shopee-products-jacartta');
  perform cron.unschedule('shopee-products-espaco-de-bicho');
  perform cron.unschedule('shopee-products-donacor');
  perform cron.unschedule('shopee-products-oliverhome');
  perform cron.unschedule('oraculo-shopee-price-product-hourly');
exception
  when others then null;
end $$;

select cron.schedule('shopee-products-jacartta',        '22 * * * *',
  $$ select private.invoke_shopee_function('shopee-sync-products?shop_id=279375549', 300000); $$);
select cron.schedule('shopee-products-espaco-de-bicho', '32 * * * *',
  $$ select private.invoke_shopee_function('shopee-sync-products?shop_id=823664460', 300000); $$);
select cron.schedule('shopee-products-donacor',         '44 * * * *',
  $$ select private.invoke_shopee_function('shopee-sync-products?shop_id=1227023039', 300000); $$);
select cron.schedule('shopee-products-oliverhome',      '52 * * * *',
  $$ select private.invoke_shopee_function('shopee-sync-products?shop_id=1540426526', 300000); $$);

select cron.schedule('oraculo-shopee-price-product-hourly', '57 * * * *',
  $$ select private.invoke_shopee_function('shopee-price-product-refresh', 300000); $$);
