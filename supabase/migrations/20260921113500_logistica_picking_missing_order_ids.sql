-- A importação mensal pode descobrir hoje pedidos antigos sem payload.itens.
-- O fechamento usa first_seen_at e precisa hidratar essas lacunas por ID,
-- independentemente da data de criação do pedido na Olist.

create or replace function public.logistica_picking_missing_order_ids(
  p_start timestamptz,
  p_end timestamptz,
  p_limit integer default 101
)
returns table(order_id text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select o.id
  from public.olist_orders o
  left join public.dim_order_status status
    on status.source = 'olist'
   and status.code = o.situacao
  where o.first_seen_at > p_start
    and o.first_seen_at <= p_end
    and trim(coalesce(o.payload->'ecommerce'->>'nome', '')) <> ''
    and not coalesce(status.is_canceled, o.situacao = '8', false)
    and jsonb_array_length(
      case
        when jsonb_typeof(o.payload->'itens') = 'array' then o.payload->'itens'
        else '[]'::jsonb
      end
    ) = 0
  order by o.first_seen_at, o.id
  limit least(greatest(coalesce(p_limit, 101), 1), 201);
$$;

revoke all on function public.logistica_picking_missing_order_ids(timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.logistica_picking_missing_order_ids(timestamptz, timestamptz, integer)
  to service_role;

comment on function public.logistica_picking_missing_order_ids(timestamptz, timestamptz, integer) is
  'Lista IDs de pedidos candidatos à separação sem itens para hidratação direcionada antes do fechamento.';
