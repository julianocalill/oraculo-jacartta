-- Itens de pedido do Mercado Livre (por anúncio/variação). Até aqui o
-- mercadolivre-sync só agregava vendas por dia (mercadolivre_sales_daily);
-- o pedido individual era descartado. O de-para de SKUs (anúncio do canal →
-- SKU Olist) precisa do pedido item a item para casar com o lado Olist pelo
-- numeroPedidoEcommerce — e a API v3 da Olist não expõe o vínculo de anúncios.
-- Escrita exclusiva do mercadolivre-sync (service_role); leitura só pela
-- refresh function do de-para (security definer).

create table if not exists public.mercadolivre_order_items (
  seller_id bigint not null,
  ml_order_id text not null,          -- order.id (= numeroPedidoEcommerce na Olist)
  pack_id text,                       -- order.pack_id (carrinho; fallback de match)
  mlb_id text not null,
  variation_id text not null default '',  -- '' quando o anúncio não tem variação
  seller_sku text,                    -- order_items[].item.seller_sku ?? seller_custom_field
  quantity integer not null default 0,
  unit_price numeric,
  date_created timestamptz,
  synced_at timestamptz not null default now(),
  primary key (seller_id, ml_order_id, mlb_id, variation_id)
);

create index if not exists mercadolivre_order_items_order_idx
  on public.mercadolivre_order_items (ml_order_id);
create index if not exists mercadolivre_order_items_pack_idx
  on public.mercadolivre_order_items (pack_id) where pack_id is not null;
create index if not exists mercadolivre_order_items_mlb_idx
  on public.mercadolivre_order_items (seller_id, mlb_id);

alter table public.mercadolivre_order_items enable row level security;
revoke all on table public.mercadolivre_order_items from public, anon, authenticated;
grant all on table public.mercadolivre_order_items to service_role;

comment on table public.mercadolivre_order_items is
  'Itens de pedido ML por anúncio/variação. Base do de-para de SKUs (canal → Olist); escrita só via mercadolivre-sync.';
