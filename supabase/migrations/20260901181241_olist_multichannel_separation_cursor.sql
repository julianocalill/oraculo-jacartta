-- Separação operacional multicanal (Olist -> n8n -> WhatsApp).
--
-- A API de pedidos da Olist entrega dataCriacao sem horário e o synced_at é
-- regravado em cada varredura. first_seen_at é, portanto, o cursor operacional:
-- fica NULL no histórico já existente e recebe now() somente em pedidos novos.

alter table public.olist_orders
  add column if not exists first_seen_at timestamptz;

alter table public.olist_orders
  alter column first_seen_at set default now();

create index if not exists olist_orders_first_seen_at_idx
  on public.olist_orders (first_seen_at, id)
  where first_seen_at is not null;

comment on column public.olist_orders.first_seen_at is
  'Primeiro instante em que o pedido entrou na base do Oráculo. Histórico anterior à criação da coluna permanece NULL. Cursor operacional do relatório multicanal; não representa a hora de criação no marketplace.';

create or replace function public.olist_multichannel_separation_report(
  p_first_seen_start timestamptz,
  p_first_seen_end timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with candidate_orders as (
  select
    o.id,
    trim(coalesce(o.payload->'ecommerce'->>'nome', '')) as marketplace,
    case
      when jsonb_typeof(o.payload->'itens') = 'array' then o.payload->'itens'
      else '[]'::jsonb
    end as items
  from public.olist_orders o
  left join public.dim_order_status status
    on status.source = 'olist'
   and status.code = o.situacao
  where o.first_seen_at > p_first_seen_start
    and o.first_seen_at <= p_first_seen_end
    and trim(coalesce(o.payload->'ecommerce'->>'nome', '')) <> ''
    and not coalesce(status.is_canceled, o.situacao = '8', false)
), item_lines as (
  select
    orders.id as order_id,
    orders.marketplace,
    trim(coalesce(item->'produto'->>'sku', '')) as sku,
    trim(coalesce(item->'produto'->>'descricao', 'Produto sem descrição')) as description,
    trim(coalesce(item->'produto'->>'tipo', '')) as product_type,
    case
      when replace(coalesce(item->>'quantidade', ''), ',', '.') ~ '^[0-9]+([.][0-9]+)?$'
        then replace(item->>'quantidade', ',', '.')::numeric
      else 0::numeric
    end as quantity
  from candidate_orders orders
  cross join lateral jsonb_array_elements(orders.items) item
), grouped_items as (
  select
    sku,
    description,
    product_type,
    count(distinct order_id)::integer as orders_count,
    sum(quantity) as quantity,
    array_agg(distinct marketplace order by marketplace) as marketplaces
  from item_lines
  where quantity > 0
  group by sku, description, product_type
), marketplace_totals as (
  select
    marketplace,
    count(distinct order_id)::integer as orders_count,
    coalesce(sum(quantity), 0::numeric) as quantity
  from item_lines
  group by marketplace
), totals as (
  select
    count(*)::integer as orders_count,
    count(*) filter (where jsonb_array_length(items) = 0)::integer as orders_without_items
  from candidate_orders
)
select jsonb_build_object(
  'source', 'Olist ERP via Oráculo/Supabase',
  'cursor_start', p_first_seen_start,
  'cursor_end', p_first_seen_end,
  'orders_count', totals.orders_count,
  'orders_without_items', totals.orders_without_items,
  'marketplaces', coalesce((
    select jsonb_agg(jsonb_build_object(
      'marketplace', marketplace,
      'orders_count', orders_count,
      'quantity', quantity
    ) order by quantity desc, marketplace)
    from marketplace_totals
  ), '[]'::jsonb),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'sku', sku,
      'product', description,
      'description', description,
      'product_type', product_type,
      'orders_count', orders_count,
      'quantity', quantity,
      'marketplaces', marketplaces
    ) order by quantity desc, sku, description)
    from grouped_items
  ), '[]'::jsonb)
)
from totals;
$$;

revoke all on function public.olist_multichannel_separation_report(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.olist_multichannel_separation_report(timestamptz, timestamptz)
  to service_role;

comment on function public.olist_multichannel_separation_report(timestamptz, timestamptz) is
  'Consolida pedidos marketplace vistos pela primeira vez no intervalo. Soma linhas com o mesmo SKU e a mesma descrição e retorna somente dados operacionais agregados, sem comprador ou endereço. Uso service_role pelo n8n.';

-- O job anterior retomava um cursor longo de três dias; em pico, os pedidos
-- mais novos só eram revisitados depois de várias horas. Cada execução passa a
-- recomeçar no topo (orderBy desc). Cinco páginas a cada 15 minutos dão folga
-- sobre o volume medido e garantem que first_seen_at represente a chegada nova.
do $$
begin
  perform cron.unschedule('oraculo-olist-orders-hourly');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-orders-hourly',
  '5,20,35,50 * * * *',
  $job$
    select private.invoke_oraculo_sync_function(
      'olist-sync-orders',
      '{"lookbackDays": 3, "maxPages": 5, "hydrateDetails": true, "detailDelayMs": 150, "resume": false}'::jsonb,
      300000
    );
  $job$
);
