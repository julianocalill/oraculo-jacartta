-- 1) Bucketing de data do Shopee direto em BRT (America/Sao_Paulo).
--    create_time vem em UTC da API; `::date` puro joga pedidos da noite para o
--    dia seguinte e desalinha a comparação diária com o Olist (que data em BRT).
-- 2) View de cobertura Olist × Shopee direto — materializa o papel da fonte
--    direta como camada de double-check.

-- Ramo Olist inalterado (idêntico a 20260620120000); só o ramo Shopee muda.
create or replace view public.oraculo_orders_unified
with (security_invoker = true)
as
select
  'olist'::text as source,
  coalesce(nullif(o.payload #>> '{ecommerce,nome}', ''), 'Olist') as channel_name,
  o.id as order_id,
  o.numero_pedido as order_number,
  o.data_criacao as order_created_at,
  o.data_criacao::date as order_date,
  o.situacao as status_code,
  coalesce(ds.label, o.situacao) as status_label,
  coalesce(ds.is_canceled, o.situacao = '8', false) as is_canceled,
  coalesce(
    public.oraculo_money_value(o.payload->>'valorTotalPedido'),
    public.oraculo_money_value(o.payload->>'valor'),
    public.oraculo_money_value(o.payload->>'total'),
    public.oraculo_money_value(o.payload->>'valorTotal'),
    public.oraculo_money_value(o.payload->>'valorTotalProdutos'),
    public.oraculo_money_value(o.payload->>'valor_total'),
    public.oraculo_money_value(o.payload->>'totalPedido'),
    public.oraculo_money_value(o.payload #>> '{totais,total}'),
    0
  ) as gross_amount,
  case
    when coalesce(ds.is_canceled, o.situacao = '8', false) then 0::numeric
    else coalesce(
      public.oraculo_money_value(o.payload->>'valorTotalPedido'),
      public.oraculo_money_value(o.payload->>'valor'),
      public.oraculo_money_value(o.payload->>'total'),
      public.oraculo_money_value(o.payload->>'valorTotal'),
      public.oraculo_money_value(o.payload->>'valorTotalProdutos'),
      public.oraculo_money_value(o.payload->>'valor_total'),
      public.oraculo_money_value(o.payload->>'totalPedido'),
      public.oraculo_money_value(o.payload #>> '{totais,total}'),
      0
    )
  end as net_amount,
  o.cliente->>'nome' as customer_name,
  o.payload as raw_json
from public.olist_orders o
left join public.dim_order_status ds
  on ds.source = 'olist'
 and ds.code = o.situacao

union all

select
  'shopee'::text as source,
  coalesce(nullif(s.shop_name, ''), 'Shopee') as channel_name,
  s.id as order_id,
  s.order_sn as order_number,
  s.create_time as order_created_at,
  (s.create_time at time zone 'America/Sao_Paulo')::date as order_date,
  s.order_status as status_code,
  s.order_status as status_label,
  upper(coalesce(s.order_status, '')) in ('CANCELLED', 'IN_CANCEL') as is_canceled,
  coalesce(s.total_amount, 0) as gross_amount,
  case
    when upper(coalesce(s.order_status, '')) in ('CANCELLED', 'IN_CANCEL') then 0::numeric
    else coalesce(s.total_amount, 0)
  end as net_amount,
  coalesce(nullif(s.recipient_name, ''), nullif(s.buyer_username, '')) as customer_name,
  s.raw_json
from public.shopee_orders s;

-- Refresh do cache unificado: ramo Shopee bucketiza em BRT e a janela usa
-- meia-noite BRT (não UTC) como borda.
create or replace function public.refresh_oraculo_channel_sales_unified_cache(p_start_date date, p_end_date date)
returns bigint
language sql
as $$
  with deleted as (
    delete from public.oraculo_channel_sales_unified_cache cache
    where cache.order_date >= p_start_date
      and cache.order_date <= p_end_date
    returning 1
  ),
  olist_orders as (
    select
      o.data_criacao::date as order_date,
      'olist'::text as source,
      coalesce(nullif(o.payload #>> '{ecommerce,nome}', ''), 'Olist') as channel_name,
      coalesce(o.situacao, o.payload->>'situacao', '') = '8' as is_canceled,
      coalesce(
        public.oraculo_money_value(o.payload->>'valorTotalPedido'),
        public.oraculo_money_value(o.payload->>'valor'),
        public.oraculo_money_value(o.payload->>'total'),
        public.oraculo_money_value(o.payload->>'valorTotal'),
        public.oraculo_money_value(o.payload->>'valorTotalProdutos'),
        public.oraculo_money_value(o.payload->>'valor_total'),
        public.oraculo_money_value(o.payload->>'totalPedido'),
        public.oraculo_money_value(o.payload #>> '{totais,total}'),
        0
      ) as amount
    from public.olist_orders o
    where o.data_criacao >= p_start_date::timestamptz
      and o.data_criacao < (p_end_date + 1)::timestamptz
  ),
  shopee_orders as (
    select
      (s.create_time at time zone 'America/Sao_Paulo')::date as order_date,
      'shopee'::text as source,
      coalesce(nullif(s.shop_name, ''), 'Shopee') as channel_name,
      upper(coalesce(s.order_status, '')) in ('CANCELLED', 'IN_CANCEL') as is_canceled,
      coalesce(s.total_amount, 0) as amount
    from public.shopee_orders s
    where s.create_time >= (p_start_date::timestamp at time zone 'America/Sao_Paulo')
      and s.create_time < ((p_end_date + 1)::timestamp at time zone 'America/Sao_Paulo')
  ),
  base as (
    select * from olist_orders
    union all
    select * from shopee_orders
  ),
  grouped as (
    select
      order_date,
      source,
      channel_name,
      count(*)::bigint as orders_count,
      count(*) filter (where is_canceled)::bigint as canceled_orders,
      coalesce(sum(amount), 0) as gross_revenue,
      coalesce(sum(case when is_canceled then 0 else amount end), 0) as net_revenue,
      case
        when count(*) filter (where not is_canceled) = 0 then null::numeric
        else coalesce(sum(case when is_canceled then 0 else amount end), 0) / nullif(count(*) filter (where not is_canceled), 0)
      end as average_ticket
    from base
    group by order_date, source, channel_name
  ),
  inserted as (
    insert into public.oraculo_channel_sales_unified_cache (
      order_date,
      source,
      channel_name,
      orders_count,
      canceled_orders,
      gross_revenue,
      net_revenue,
      average_ticket,
      refreshed_at
    )
    select
      order_date,
      source,
      channel_name,
      orders_count,
      canceled_orders,
      gross_revenue,
      net_revenue,
      average_ticket,
      now()
    from grouped
    on conflict (order_date, source, channel_name) do update set
      orders_count = excluded.orders_count,
      canceled_orders = excluded.canceled_orders,
      gross_revenue = excluded.gross_revenue,
      net_revenue = excluded.net_revenue,
      average_ticket = excluded.average_ticket,
      refreshed_at = excluded.refreshed_at
    returning 1
  )
  select count(*)::bigint from inserted;
$$;

-- Cobertura diária Olist × Shopee direto, por loja (double-check).
-- match_pct ~100 = fontes concordam; <100 = direto ainda alcançando (forward-only).
create or replace view public.oraculo_shopee_coverage_check
with (security_invoker = true)
as
with map (olist_channel, direct_channel, loja) as (
  values
    ('Shopee Donacor',  'Donacor',          'Donacor'),
    ('Shopee Oliver',   'Oliverhome',       'Oliver'),
    ('Shopee toca',     'Espaço De Bicho',  'Toca / Espaço de Bicho'),
    ('Shopee Jacartta', 'Jacartta',         'Jacartta')
),
olist as (
  select c.order_date, m.loja,
         sum(c.orders_count) as olist_orders,
         sum(c.net_revenue) as olist_revenue
  from public.oraculo_channel_sales_unified_cache c
  join map m on m.olist_channel = c.channel_name
  where c.source = 'olist'
  group by c.order_date, m.loja
),
direto as (
  select c.order_date, m.loja,
         sum(c.orders_count) as direct_orders,
         sum(c.net_revenue) as direct_revenue
  from public.oraculo_channel_sales_unified_cache c
  join map m on m.direct_channel = c.channel_name
  where c.source = 'shopee'
  group by c.order_date, m.loja
)
select
  coalesce(o.order_date, d.order_date) as order_date,
  coalesce(o.loja, d.loja) as loja,
  coalesce(o.olist_orders, 0) as olist_orders,
  coalesce(d.direct_orders, 0) as direct_orders,
  coalesce(o.olist_revenue, 0) as olist_revenue,
  coalesce(d.direct_revenue, 0) as direct_revenue,
  round(100.0 * coalesce(d.direct_orders, 0) / nullif(o.olist_orders, 0), 1) as match_orders_pct,
  round(100.0 * coalesce(d.direct_revenue, 0) / nullif(o.olist_revenue, 0), 1) as match_revenue_pct
from olist o
full join direto d using (order_date, loja);
