-- De-para SKU do anúncio (canal) → SKU do cadastro Olist, derivado por
-- co-ocorrência de pedidos casados pelo numeroPedidoEcommerce. A Olist tem o
-- vínculo de anúncios internamente, mas a API pública Tiny v3 NÃO o expõe
-- (só existe PUT /anuncios/{idMapeamento}/preco — sem GET de listagem;
-- verificado no swagger em 2026-08-16). Então o de-para sai por evidência de
-- venda: pedidos "inequívocos" (exatamente 1 SKU distinto de cada lado do
-- pedido) geram pares canal→Olist, agregados com contagem e dominância.
--
-- Precedente validado: oraculo_returns_reconciled (20260804120000) — 97,6% das
-- NFs de venda casadas têm SKU único, e o SKU do canal só bate por string com
-- o da Olist em 19% dos casos, por isso NÃO se tenta traduzir por igualdade.
--
-- Compute pequeno: agregação roda em cache table + refresh on-demand com
-- throttle de 6h, disparado pela rota de export (/skus/de-para/export).
-- Sem novo job de cron (worker slots no limite — 20260805190000): o leitor e o
-- refresher são o mesmo code path, então o cache não congela silenciosamente;
-- o refreshed_at vai impresso na planilha.

create table if not exists public.oraculo_sku_channel_map_cache (
  channel text not null,                 -- 'shopee' | 'mercadolivre' | 'tiktok'
  channel_key text not null,             -- identidade do anúncio/variação no canal
  channel_sku text,                      -- SKU do seller no canal (quando existe)
  channel_item_id text,                  -- item_id Shopee / MLB / product_id TikTok
  channel_variation text,                -- model_name / atributos / sku_name
  channel_product_name text,
  sku_olist text,
  olist_product_name text,
  olist_is_kit boolean,
  orders_matched integer not null default 0,  -- pedidos co-ocorrentes deste par
  orders_total integer not null default 0,    -- pedidos inequívocos do channel_key
  share numeric,                         -- orders_matched / orders_total
  qty_ratio numeric,                     -- média qty_olist / qty_canal (kit desmembrado ⇒ >1)
  last_sale_at timestamptz,
  pair_rank integer not null default 1,  -- 1 = par dominante; 2 = vice (evidência da ambiguidade)
  match_status text not null,            -- 'mapeado' | 'ambiguo' | 'sem_casamento'
  evidence text,                         -- 'pedido_unico' (futuro: 'sku_igual')
  refreshed_at timestamptz not null default now(),
  primary key (channel, channel_key, pair_rank)
);

create index if not exists oraculo_sku_channel_map_status_idx
  on public.oraculo_sku_channel_map_cache (channel, match_status);

alter table public.oraculo_sku_channel_map_cache enable row level security;
revoke all on table public.oraculo_sku_channel_map_cache from public, anon, authenticated;
grant all on table public.oraculo_sku_channel_map_cache to service_role;

comment on table public.oraculo_sku_channel_map_cache is
  'De-para SKU anúncio (canal) → SKU Olist por co-ocorrência de pedidos casados. Refresh on-demand pela rota /skus/de-para/export (throttle 6h), sem cron.';

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
           min(oi.model_name)      as channel_variation,
           min(oi.item_name)       as channel_product_name,
           sum(oi.quantity)        as qty_channel
      from shopee_order_items oi
     group by oi.order_sn
    having count(distinct (oi.item_id, coalesce(oi.model_id, ''))) = 1
  ),
  -- TikTok: a integração direta (tiktok_order_items) nunca foi aplicada em
  -- produção; a única fonte com (pedido do canal, SKU do canal) é a base de
  -- devoluções importadas (1.694 linhas com SKU em 2026-08). Amostra enviesada
  -- para pedidos devolvidos, mas o vínculo anúncio→produto é o mesmo.
  -- qty da devolução é a quantidade DEVOLVIDA, não a do pedido — então a razão
  -- de quantidade fica nula neste canal (não chutar kit por dado errado).
  tiktok_side as (
    select r.order_ref,
           min(r.sku_channel)     as channel_key,
           min(r.sku_channel)     as channel_sku,
           null::text             as channel_item_id,
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
           min(t.channel_sku), min(t.channel_item_id), min(t.channel_variation),
           min(t.channel_product_name),
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
           min(m.channel_sku), min(m.channel_item_id), min(m.channel_variation),
           min(m.channel_product_name),
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
         r.channel_variation, r.channel_product_name,
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

  delete from oraculo_sku_channel_map_cache;

  insert into oraculo_sku_channel_map_cache
    (channel, channel_key, channel_sku, channel_item_id, channel_variation,
     channel_product_name, sku_olist, olist_product_name, olist_is_kit,
     orders_matched, orders_total, share, qty_ratio, last_sale_at,
     pair_rank, match_status, evidence, refreshed_at)
  select channel, channel_key, channel_sku, channel_item_id, channel_variation,
         channel_product_name, sku_olist, olist_product_name, olist_is_kit,
         orders_matched, orders_total, share, qty_ratio, last_sale_at,
         pair_rank, match_status, 'pedido_unico', now()
    from _sku_map;

  -- Catálogo sem casamento: anúncios que nunca apareceram em pedido inequívoco
  -- casado (aba "Não mapeados" do export).
  insert into oraculo_sku_channel_map_cache
    (channel, channel_key, channel_sku, channel_item_id, channel_variation,
     channel_product_name, orders_matched, orders_total,
     pair_rank, match_status, refreshed_at)
  select distinct on (u.channel, u.channel_key)
         u.channel, u.channel_key, u.channel_sku, u.channel_item_id,
         u.channel_variation, u.channel_product_name, 0, 0, 1, 'sem_casamento', now()
    from (
      select 'shopee'::text as channel,
             coalesce(nullif(coalesce(sp.model_sku, sp.item_sku), ''),
                      sp.item_id || coalesce('/' || nullif(sp.model_id, ''), '')) as channel_key,
             coalesce(nullif(sp.model_sku, ''), nullif(sp.item_sku, '')) as channel_sku,
             sp.item_id   as channel_item_id,
             sp.model_name as channel_variation,
             sp.item_name  as channel_product_name
        from shopee_products sp
       where sp.item_status = 'NORMAL'
      union all
      select 'mercadolivre',
             i.mlb_id || coalesce('/' || nullif(v.variation_id, ''), ''),
             coalesce(nullif(v.sku, ''), nullif(i.sku, '')),
             i.mlb_id, v.attrs, i.title
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
             null, null, r.product_name
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

revoke all on function public.refresh_oraculo_sku_channel_map(boolean) from public, anon, authenticated;
grant execute on function public.refresh_oraculo_sku_channel_map(boolean) to service_role;

-- View de conveniência para debug/SQL ad-hoc (mesmo nome da convenção oraculo_*)
create or replace view public.oraculo_sku_channel_map as
  select * from public.oraculo_sku_channel_map_cache;
grant select on public.oraculo_sku_channel_map to service_role;

-- Popula já na migração (o lado ML fica vazio até o backfill do
-- mercadolivre-sync alimentar mercadolivre_order_items).
select public.refresh_oraculo_sku_channel_map(true);
