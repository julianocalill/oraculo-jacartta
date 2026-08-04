-- Valor do reembolso: fallback pela NF de venda quando o canal não informa.
--
-- Problema medido: o Mercado Livre não devolve valor. O /claims/search não traz
-- e o /claims/{id}/returns falhou nos 4 casos existentes (a chamada é engolida
-- de propósito para não perder a linha inteira). Resultado: as devoluções do ML
-- entravam no funil por CONTAGEM e desapareciam de todo total em R$.
--
-- Solução: não insistir na API deles. 3 dos 4 casos têm `order_ref` com o número
-- do pedido ML, e esse número já casa com a NF de venda em
-- oraculo_olist_order_ref_cache — o valor sai de lá na hora (R$ 65,90 e
-- R$ 139,90 nos casos conferidos).
--
-- ⚠️ Não é a mesma coisa. O valor da NF é o do PEDIDO; o estorno pode ser
-- parcial. Por isso o fallback NUNCA sobrescreve refund_amount: entra em
-- refund_amount_effective, com refund_amount_source dizendo de onde veio
-- ('canal' | 'nf_venda' | null). A tela mostra a origem — número estimado que
-- se disfarça de medido é pior que número ausente.

drop view if exists public.oraculo_returns_reconciled;
create view public.oraculo_returns_reconciled as
with base as (
  select r.*,
         public.oraculo_return_counts_as_loss(r.status) as counts_as_loss,
         c.invoice_id      as sale_invoice_id,
         c.channel_label   as sale_channel_label,
         c.emission_date   as sale_emission_date,
         c.client_document as sale_client_document,
         c.total_amount    as sale_total_amount
    from public.oraculo_returns r
    left join public.oraculo_olist_order_ref_cache c
      on c.order_ref = r.order_ref
), with_sku as (
  select b.*,
         s.sku_count,
         case when s.sku_count = 1 then s.single_sku else null end as sku_olist_resolved
    from base b
    left join lateral (
      select count(distinct i.sku) as sku_count,
             min(i.sku)            as single_sku
        from public.olist_invoice_items i
       where i.invoice_id = b.sale_invoice_id
    ) s on true
), matched as (
  select w.*,
         d.invoice_id     as return_invoice_id,
         d.invoice_number as return_invoice_number,
         d.emission_date  as return_invoice_date,
         d.quantity       as return_invoice_qty,
         d.total_amount   as return_invoice_value,
         d.total_value    as return_invoice_item_value,
         d.match_rank
    from with_sku w
    left join lateral (
      select dv.invoice_id,
             dv.invoice_number,
             dv.emission_date,
             dv.quantity,
             dv.total_amount,
             dv.total_value,
             case
               when w.sku_olist_resolved is not null
                and upper(btrim(coalesce(dv.sku, ''))) = upper(btrim(w.sku_olist_resolved))
                 then 1
               else 2
             end as match_rank
        from public.oraculo_olist_devolucoes dv
       where w.sale_client_document is not null
         and dv.client_document = w.sale_client_document
         and dv.emission_date >= w.sale_emission_date
         and dv.emission_date < w.sale_emission_date + interval '90 days'
       order by match_rank, dv.emission_date
       limit 1
    ) d on true
)
select m.*,
       coalesce(m.sku_olist, m.sku_olist_resolved) as sku_olist_final,
       coalesce(m.refund_amount, m.sale_total_amount) as refund_amount_effective,
       case
         when m.refund_amount is not null then 'canal'
         when m.sale_total_amount is not null then 'nf_venda'
         else null
       end as refund_amount_source,
       case
         when m.match_rank = 1 then 'exato'
         when m.match_rank = 2 then 'provavel'
         else 'sem_match'
       end as match_score,
       case
         when m.sale_invoice_id is null then 'sem_nf_venda'
         when m.counts_as_loss
              and coalesce(m.return_type, 'return_and_refund') = 'return_and_refund'
              and m.return_invoice_id is null
           then 'sem_nf_devolucao'
         when m.counts_as_loss
              and m.return_invoice_value is not null
              and m.refund_amount is not null
              and m.refund_amount > 0
              and abs(m.return_invoice_value - m.refund_amount) / m.refund_amount > 0.05
           then 'divergencia_valor'
         when m.counts_as_loss
              and m.return_invoice_qty is not null
              and m.qty is not null
              and m.return_invoice_qty <> m.qty
           then 'divergencia_qtd'
         else null
       end as flag
  from matched m;

comment on view public.oraculo_returns_reconciled is
  'Devolução do canal cruzada com a NF de devolução da Olist. SKU Olist vem da NF de VENDA casada pelo número do pedido. refund_amount_effective usa o valor do canal e, na falta dele (Mercado Livre), o da NF de venda — refund_amount_source diz qual. Valor compara contra total_amount da NF, nunca total_value do item.';

grant select on public.oraculo_returns_reconciled to authenticated, service_role;

-- Agregados passam a usar o valor efetivo. A divergência de valor NÃO usa: só
-- faz sentido comparar contra o que o canal de fato estornou.
create or replace function public.oraculo_returns_funnel(
  p_from timestamptz, p_to timestamptz, p_channel text default null
)
returns table (
  channel text, stage text, stage_order integer,
  returns_count bigint, units numeric, amount numeric
)
language sql
stable
as $$
  with base as (
    select r.*
      from public.oraculo_returns_reconciled r
     where r.opened_at >= p_from and r.opened_at < p_to
       and (p_channel is null or r.channel = p_channel)
  )
  select channel, 'abertas', 1, count(*), sum(qty), sum(refund_amount_effective) from base group by channel
  union all
  select channel, 'aguardando_decisao', 2, count(*), sum(qty), sum(refund_amount_effective)
    from base where status = 'aberta' group by channel
  union all
  select channel, 'cancelada', 3, count(*), sum(qty), sum(refund_amount_effective)
    from base where status = 'cancelada' group by channel
  union all
  select channel, 'reembolso_recusado', 4, count(*), sum(qty), sum(refund_amount_effective)
    from base where status = 'recusada' group by channel
  union all
  select channel, 'reembolso_concedido', 5, count(*), sum(qty), sum(refund_amount_effective)
    from base where status = 'aceita' group by channel
  union all
  select channel, 'produto_retorna', 6, count(*), sum(qty), sum(refund_amount_effective)
    from base
   where status = 'aceita' and coalesce(return_type, 'return_and_refund') = 'return_and_refund'
   group by channel
  union all
  select channel, 'nf_devolucao_confere', 7, count(*), sum(qty), sum(refund_amount_effective)
    from base
   where status = 'aceita' and coalesce(return_type, 'return_and_refund') = 'return_and_refund'
     and flag is null
   group by channel
  union all
  select channel, 'sem_nf_devolucao', 8, count(*), sum(qty), sum(refund_amount_effective)
    from base where flag = 'sem_nf_devolucao' group by channel
  order by 1, 3;
$$;

drop function if exists public.oraculo_returns_summary(timestamptz, timestamptz, text);
create function public.oraculo_returns_summary(
  p_from timestamptz, p_to timestamptz, p_channel text default null
)
returns table (
  channel text,
  returns_total bigint,
  returns_loss bigint,
  units numeric,
  refund_amount numeric,
  amount_from_nf bigint,
  sem_nf_venda_count bigint,
  sem_nf_count bigint,
  sem_nf_amount numeric,
  divergencia_count bigint
)
language sql
stable
as $$
  select r.channel,
         count(*),
         count(*) filter (where r.counts_as_loss),
         sum(r.qty) filter (where r.counts_as_loss),
         sum(r.refund_amount_effective) filter (where r.counts_as_loss),
         -- quantas linhas tiveram o valor estimado pela NF em vez de informado
         count(*) filter (where r.counts_as_loss and r.refund_amount_source = 'nf_venda'),
         count(*) filter (where r.flag = 'sem_nf_venda'),
         count(*) filter (where r.flag = 'sem_nf_devolucao'),
         sum(r.refund_amount_effective) filter (where r.flag = 'sem_nf_devolucao'),
         count(*) filter (where r.flag in ('divergencia_valor', 'divergencia_qtd'))
    from public.oraculo_returns_reconciled r
   where r.opened_at >= p_from and r.opened_at < p_to
     and (p_channel is null or r.channel = p_channel)
   group by r.channel
   order by 5 desc nulls last;
$$;

drop function if exists public.oraculo_returns_by_sku(timestamptz, timestamptz, text, integer);
create function public.oraculo_returns_by_sku(
  p_from timestamptz, p_to timestamptz, p_channel text default null, p_limit integer default 100
)
returns table (
  sku text, sku_channel text, product_name text,
  returns_count bigint, units numeric, refund_amount numeric,
  unit_cost numeric, cost_lost numeric, sem_nf_count bigint
)
language sql
stable
as $$
  select coalesce(r.sku_olist_final, r.sku_channel),
         min(r.sku_channel),
         min(r.product_name),
         count(*),
         sum(r.qty),
         sum(r.refund_amount_effective),
         max(uc.unit_cost),
         sum(r.qty) * max(uc.unit_cost),
         count(*) filter (where r.flag = 'sem_nf_devolucao')
    from public.oraculo_returns_reconciled r
    left join public.oraculo_sku_unit_cost uc on uc.sku = r.sku_olist_final
   where r.opened_at >= p_from and r.opened_at < p_to
     and r.counts_as_loss
     and (p_channel is null or r.channel = p_channel)
   group by 1
   order by 6 desc nulls last
   limit p_limit;
$$;

grant execute on function public.oraculo_returns_funnel(timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.oraculo_returns_summary(timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.oraculo_returns_by_sku(timestamptz, timestamptz, text, integer) to authenticated, service_role;
