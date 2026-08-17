-- REGRESSÃO: as funções de refresh que fazem rebuild com "delete from <cache>;"
-- funcionam via SQL direto (migrations, pg_cron), mas FALHAM quando chamadas
-- via PostgREST/RPC — o safeupdate das conexões da API exige WHERE no DELETE
-- ("DELETE requires a WHERE clause", code 21000). Efeito medido em 17/08:
-- todos os runs horários do shopee-price-product-refresh falharam desde 12:57
-- UTC (cache congelado às 12:19), e o refresh_oraculo_sku_channel_map chamado
-- pela rota /skus/de-para/export falhava em silêncio (try/catch da rota).
-- Correção: "delete ... where true" satisfaz o safeupdate sem mudar a semântica.
-- As funções são recriadas por inteiro a partir das versões vigentes
-- (20260817150000 e 20260816160000) — mudança única: o WHERE no delete.

-- 1) Vendas diárias (60d) ----------------------------------------------------

create or replace function public.refresh_oraculo_shopee_precos_sales_daily()
returns void
language sql
security definer
set search_path = public
set statement_timeout to '120s'
as $$
  delete from oraculo_shopee_precos_sales_daily where true;
  insert into oraculo_shopee_precos_sales_daily
    (shop_id, item_id, model_id, sale_date, units, orders_count, refreshed_at)
  select oi.shop_id,
         oi.item_id,
         coalesce(nullif(oi.model_id, ''), '0'),
         (o.create_time at time zone 'America/Sao_Paulo')::date,
         sum(oi.quantity),
         count(distinct oi.order_sn),
         now()
    from shopee_order_items oi
    join shopee_orders o on o.id = oi.order_id
   where o.create_time > now() - interval '60 days'
     and o.order_status not in ('CANCELLED', 'UNPAID')
     and oi.item_id is not null
   group by 1, 2, 3, 4;
$$;

-- 2) De-para de SKUs ---------------------------------------------------------

create or replace function public.refresh_oraculo_sku_channel_map(p_force boolean default false)
returns timestamptz
language plpgsql
security definer
set search_path = public
set statement_timeout to '300s'
as $$
declare
  v_last timestamptz;
begin
  select max(refreshed_at) into v_last from oraculo_sku_channel_map_cache;
  if not p_force and v_last is not null and v_last > now() - interval '6 hours' then
    return v_last;  -- throttle: export subsequente lê o cache pronto
  end if;

  create temp table _sku_map on commit drop as
  with
  -- Lado Olist: NF de venda com exatamente 1 SKU distinto. Vem inteiro do
  -- cache estreito (zero detoast de olist_orders/olist_invoices.payload).
  olist_side as (
    select c.order_ref,
           case
             when min(c.channel_label) ilike '%shopee%'  then 'shopee'
             when min(c.channel_label) ilike '%mercado%' then 'mercadolivre'
             when min(c.channel_label) ilike '%tiktok%'  then 'tiktok'
           end as channel,
           min(ii.sku)          as sku_olist,
           min(ii.description)  as olist_desc,
           sum(ii.quantity)     as qty_olist,
           max(c.emission_date) as sold_at
      from oraculo_olist_order_ref_cache c
      join olist_invoice_items ii on ii.invoice_id = c.invoice_id
     where c.order_ref is not null
       and nullif(ii.sku, '') is not null
     group by c.order_ref
    having count(distinct ii.sku) = 1
  ),
  shopee_side as (
    select oi.order_sn as order_ref,
           min(coalesce(nullif(oi.sku, ''),
                        oi.item_id || coalesce('/' || nullif(oi.model_id, ''), ''))) as channel_key,
           min(nullif(oi.sku, '')) as channel_sku,
           min(oi.item_id)         as channel_item_id,
           min(nullif(oi.model_id, '')) as channel_model_id,
           min(oi.model_name)      as channel_variation,
           min(oi.item_name)       as channel_product_name,
           sum(oi.quantity)        as qty_channel
      from shopee_order_items oi
     group by oi.order_sn
    having count(distinct (oi.item_id, coalesce(oi.model_id, ''))) = 1
  ),
  -- TikTok: a integração direta (tiktok_order_items) nunca foi aplicada em
  -- produção; a única fonte com (pedido do canal, SKU do canal) é a base de
  -- devoluções importadas. Amostra enviesada para pedidos devolvidos, mas o
  -- vínculo anúncio→produto é o mesmo. qty da devolução é a quantidade
  -- DEVOLVIDA, não a do pedido — razão de quantidade fica nula neste canal.
  tiktok_side as (
    select r.order_ref,
           min(r.sku_channel)     as channel_key,
           min(r.sku_channel)     as channel_sku,
           null::text             as channel_item_id,
           null::text             as channel_model_id,
           null::text             as channel_variation,
           min(r.product_name)    as channel_product_name,
           null::numeric          as qty_channel
      from oraculo_returns r
     where r.channel = 'tiktok'
       and nullif(r.order_ref, '') is not null
       and nullif(r.sku_channel, '') is not null
     group by r.order_ref
    having count(distinct r.sku_channel) = 1
  ),
  ml_side as (
    select mo.ml_order_id as order_ref,
           min(mo.pack_id) as pack_id,
           min(mo.mlb_id || case when mo.variation_id <> '' then '/' || mo.variation_id else '' end) as channel_key,
           min(nullif(mo.seller_sku, '')) as channel_sku,
           min(mo.mlb_id)                 as channel_item_id,
           min(nullif(mo.variation_id, '')) as channel_model_id,
           min(v.attrs)                   as channel_variation,
           min(i.title)                   as channel_product_name,
           sum(mo.quantity)               as qty_channel
      from mercadolivre_order_items mo
      left join mercadolivre_items i
        on i.seller_id = mo.seller_id and i.mlb_id = mo.mlb_id
      left join mercadolivre_variations v
        on v.seller_id = mo.seller_id and v.mlb_id = mo.mlb_id and v.variation_id = mo.variation_id
     group by mo.ml_order_id
    having count(distinct (mo.mlb_id, mo.variation_id)) = 1
  ),
  pairs as (
    select 'shopee'::text as channel, s.channel_key,
           min(s.channel_sku) as channel_sku,
           min(s.channel_item_id) as channel_item_id,
           min(s.channel_model_id) as channel_model_id,
           min(s.channel_variation) as channel_variation,
           min(s.channel_product_name) as channel_product_name,
           o.sku_olist, min(o.olist_desc) as olist_desc,
           count(*) as orders_matched,
           avg(o.qty_olist / nullif(s.qty_channel, 0)) as qty_ratio,
           max(o.sold_at) as last_sale_at
      from shopee_side s
      join olist_side o on o.channel = 'shopee' and o.order_ref = s.order_ref
     group by s.channel_key, o.sku_olist
    union all
    select 'tiktok', t.channel_key,
           min(t.channel_sku), min(t.channel_item_id), min(t.channel_model_id),
           min(t.channel_variation), min(t.channel_product_name),
           o.sku_olist, min(o.olist_desc),
           count(*),
           avg(o.qty_olist / nullif(t.qty_channel, 0)),
           max(o.sold_at)
      from tiktok_side t
      join olist_side o on o.channel = 'tiktok' and o.order_ref = t.order_ref
     group by t.channel_key, o.sku_olist
    union all
    -- ML: o numeroPedidoEcommerce pode ser o order id OU o pack id (carrinho)
    select 'mercadolivre', m.channel_key,
           min(m.channel_sku), min(m.channel_item_id), min(m.channel_model_id),
           min(m.channel_variation), min(m.channel_product_name),
           o.sku_olist, min(o.olist_desc),
           count(*),
           avg(o.qty_olist / nullif(m.qty_channel, 0)),
           max(o.sold_at)
      from ml_side m
      join olist_side o on o.channel = 'mercadolivre'
       and (o.order_ref = m.order_ref or o.order_ref = m.pack_id)
     group by m.channel_key, o.sku_olist
  ),
  ranked as (
    select p.*,
           sum(p.orders_matched) over (partition by p.channel, p.channel_key) as orders_total,
           row_number() over (partition by p.channel, p.channel_key
                              order by p.orders_matched desc, p.last_sale_at desc) as pair_rank
      from pairs p
  ),
  -- olist_products tem SKU repetido (cadastros duplicados); sem dedupe o join
  -- fanaria as linhas e estouraria a PK do cache.
  olist_prod as (
    select sku,
           min(nome) as nome,
           bool_or(tipo = 'K') as is_kit
      from olist_products
     where nullif(sku, '') is not null
     group by sku
  )
  select r.channel, r.channel_key, r.channel_sku, r.channel_item_id,
         r.channel_model_id, r.channel_variation, r.channel_product_name,
         r.sku_olist,
         coalesce(op.nome, r.olist_desc) as olist_product_name,
         coalesce(op.is_kit, false)      as olist_is_kit,
         r.orders_matched, r.orders_total,
         round(r.orders_matched::numeric / nullif(r.orders_total, 0), 4) as share,
         round(r.qty_ratio::numeric, 2) as qty_ratio,
         r.last_sale_at,
         r.pair_rank,
         case
           when r.pair_rank > 1 then 'ambiguo'
           when r.orders_matched >= 2
            and r.orders_matched::numeric / nullif(r.orders_total, 0) >= 0.8 then 'mapeado'
           else 'ambiguo'
         end as match_status
    from ranked r
    left join olist_prod op on op.sku = r.sku_olist
   where r.pair_rank <= 2;  -- dominante + vice (o vice documenta a ambiguidade)

  delete from oraculo_sku_channel_map_cache where true;

  insert into oraculo_sku_channel_map_cache
    (channel, channel_key, channel_sku, channel_item_id, channel_model_id,
     channel_variation, channel_product_name, sku_olist, olist_product_name,
     olist_is_kit, orders_matched, orders_total, share, qty_ratio, last_sale_at,
     pair_rank, match_status, evidence, refreshed_at)
  select channel, channel_key, channel_sku, channel_item_id, channel_model_id,
         channel_variation, channel_product_name, sku_olist, olist_product_name,
         olist_is_kit, orders_matched, orders_total, share, qty_ratio, last_sale_at,
         pair_rank, match_status, 'pedido_unico', now()
    from _sku_map;

  -- Catálogo sem casamento: anúncios que nunca apareceram em pedido inequívoco
  -- casado (aba "Não mapeados" do export).
  insert into oraculo_sku_channel_map_cache
    (channel, channel_key, channel_sku, channel_item_id, channel_model_id,
     channel_variation, channel_product_name, orders_matched, orders_total,
     pair_rank, match_status, refreshed_at)
  select distinct on (u.channel, u.channel_key)
         u.channel, u.channel_key, u.channel_sku, u.channel_item_id,
         u.channel_model_id, u.channel_variation, u.channel_product_name,
         0, 0, 1, 'sem_casamento', now()
    from (
      select 'shopee'::text as channel,
             coalesce(nullif(coalesce(sp.model_sku, sp.item_sku), ''),
                      sp.item_id || coalesce('/' || nullif(sp.model_id, ''), '')) as channel_key,
             coalesce(nullif(sp.model_sku, ''), nullif(sp.item_sku, '')) as channel_sku,
             sp.item_id   as channel_item_id,
             nullif(sp.model_id, '') as channel_model_id,
             sp.model_name as channel_variation,
             sp.item_name  as channel_product_name
        from shopee_products sp
       where sp.item_status = 'NORMAL'
      union all
      select 'mercadolivre',
             i.mlb_id || coalesce('/' || nullif(v.variation_id, ''), ''),
             coalesce(nullif(v.sku, ''), nullif(i.sku, '')),
             i.mlb_id,
             nullif(v.variation_id, ''),
             v.attrs, i.title
        from mercadolivre_items i
        left join mercadolivre_variations v
          on v.seller_id = i.seller_id and v.mlb_id = i.mlb_id
       where i.status = 'active'
      union all
      -- TikTok: sem catálogo direto no banco; o universo conhecido são os SKUs
      -- que já apareceram nas devoluções importadas.
      select distinct 'tiktok',
             nullif(r.sku_channel, ''),
             nullif(r.sku_channel, ''),
             null, null, null, r.product_name
        from oraculo_returns r
       where r.channel = 'tiktok'
    ) u
   where u.channel_key is not null
     and not exists (
       select 1 from oraculo_sku_channel_map_cache c
        where c.channel = u.channel and c.channel_key = u.channel_key
     );

  return now();
end;
$$;
