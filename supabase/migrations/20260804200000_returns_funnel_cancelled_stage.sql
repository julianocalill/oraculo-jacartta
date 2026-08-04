-- O funil não fechava. Medido em julho/2026 com os três canais carregados:
--   abertas 3.196 = aguardando 464 + recusado 650 + concedido 1.559 = 2.673
-- Faltavam 523 devoluções com status 'cancelada' — pedido de devolução que o
-- comprador desistiu ou que expirou sem virar reembolso (só a Shopee tem 505
-- CANCELLED em julho).
--
-- Sem esse estágio o funil "perde" 16% do topo sem explicar para onde foi, que
-- é exatamente o defeito que torna funil enganoso. Com ele, os quatro estágios
-- de decisão somam o topo exatamente.

create or replace function public.oraculo_returns_funnel(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null
)
returns table (
  channel text,
  stage text,
  stage_order integer,
  returns_count bigint,
  units numeric,
  amount numeric
)
language sql
stable
as $$
  with base as (
    select r.*
      from public.oraculo_returns_reconciled r
     where r.opened_at >= p_from
       and r.opened_at < p_to
       and (p_channel is null or r.channel = p_channel)
  )
  select channel, 'abertas', 1, count(*), sum(qty), sum(refund_amount)
    from base group by channel
  union all
  select channel, 'aguardando_decisao', 2, count(*), sum(qty), sum(refund_amount)
    from base where status = 'aberta' group by channel
  union all
  -- Desistência do comprador ou prazo expirado: nunca virou reembolso.
  select channel, 'cancelada', 3, count(*), sum(qty), sum(refund_amount)
    from base where status = 'cancelada' group by channel
  union all
  select channel, 'reembolso_recusado', 4, count(*), sum(qty), sum(refund_amount)
    from base where status = 'recusada' group by channel
  union all
  select channel, 'reembolso_concedido', 5, count(*), sum(qty), sum(refund_amount)
    from base where status = 'aceita' group by channel
  union all
  select channel, 'produto_retorna', 6, count(*), sum(qty), sum(refund_amount)
    from base
   where status = 'aceita'
     and coalesce(return_type, 'return_and_refund') = 'return_and_refund'
   group by channel
  union all
  select channel, 'nf_devolucao_confere', 7, count(*), sum(qty), sum(refund_amount)
    from base
   where status = 'aceita'
     and coalesce(return_type, 'return_and_refund') = 'return_and_refund'
     and flag is null
   group by channel
  union all
  select channel, 'sem_nf_devolucao', 8, count(*), sum(qty), sum(refund_amount)
    from base where flag = 'sem_nf_devolucao' group by channel
  order by 1, 3;
$$;

grant execute on function public.oraculo_returns_funnel(timestamptz, timestamptz, text) to authenticated, service_role;
