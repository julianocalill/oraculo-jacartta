create or replace view public.oraculo_daily_sales
with (security_invoker = true)
as
select
  o.data_criacao::date as order_date,
  sum(coalesce(nullif(replace(o.payload #>> '{valorTotalPedido}', ',', '.'), '')::numeric, 0)) as gross_revenue,
  sum(
    case
      when coalesce(s.is_canceled, o.situacao = '8', false) then 0
      else coalesce(nullif(replace(o.payload #>> '{valorTotalPedido}', ',', '.'), '')::numeric, 0)
    end
  ) as effective_revenue,
  count(*) as orders_count,
  count(*) filter (where coalesce(s.is_canceled, o.situacao = '8', false)) as canceled_orders,
  0::numeric as units,
  case
    when count(*) filter (where not coalesce(s.is_canceled, o.situacao = '8', false)) = 0 then 0
    else sum(
      case
        when coalesce(s.is_canceled, o.situacao = '8', false) then 0
        else coalesce(nullif(replace(o.payload #>> '{valorTotalPedido}', ',', '.'), '')::numeric, 0)
      end
    ) / count(*) filter (where not coalesce(s.is_canceled, o.situacao = '8', false))
  end as average_ticket
from public.olist_orders o
left join public.dim_order_status s
  on s.source = 'olist'
  and s.code = o.situacao
where o.data_criacao is not null
group by o.data_criacao::date;
