-- Correção da reconciliação de devoluções, a partir da primeira carga real
-- (1.728 linhas do TikTok, julho/2026). Dois defeitos medidos:
--
-- 1. O SKU DO CANAL NÃO CASA COM O SKU DA NF. Só 21 de 108 SKUs do TikTok (19%)
--    existem em olist_invoice_items — a mesma armadilha de nomenclatura já
--    documentada para a Shopee ('214013' vs 'CABIDE VELUDO-50UN-PRETO').
--    Resultado: ZERO matches 'exato' e custo unitário nulo na maioria das
--    linhas, porque oraculo_sku_unit_cost é ancorado no SKU da Olist.
--
--    Correção: não tentar traduzir o SKU. A NF de VENDA já foi casada de forma
--    exata pelo número do pedido — então o SKU Olist vem DELA. Medido: 1.084
--    das 1.111 NFs de venda casadas (97,6%) têm um único SKU distinto, o que
--    torna a resolução não-ambígua. Com 2+ SKUs a NF é de pedido misto e o
--    campo fica nulo em vez de chutar.
--
-- 2. A JANELA DO CACHE COMEÇAVA TARDE DEMAIS. O cache de NF de venda começava
--    em 2026-07-01, mas uma devolução aberta em julho pode ser de um pedido
--    vendido em maio ou junho — 617 das 1.728 devoluções ficaram sem NF de
--    venda e, por tabela, foram reportadas como "sem NF de devolução", que é
--    um falso positivo caro: manda o time atrás de nota que existe.
--
--    Correção: o cache passa a cobrir a partir de 2026-05-01 (60 dias antes da
--    janela de devolução). A janela de DEVOLUÇÃO segue sendo julho em diante —
--    só o lastro de vendas recuou.

-- ---------------------------------------------------------------------------
-- 1. Cache de NF de venda recua para 2026-05-01
-- ---------------------------------------------------------------------------

create or replace function public.refresh_oraculo_olist_order_ref_cache(p_days integer default 1)
returns table (processed_day date, rows_upserted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_count integer;
begin
  for i in 1..greatest(p_days, 1) loop
    -- 2026-05-01: 60 dias de lastro antes da janela de devoluções (2026-07-01),
    -- porque a venda que originou a devolução costuma ser de meses anteriores.
    select d::date into v_day
      from generate_series(date '2026-05-01', (now() at time zone 'UTC')::date, interval '1 day') d
     where not exists (
       select 1 from public.oraculo_olist_order_ref_cache c
        where c.emission_date >= d
          and c.emission_date < d + interval '1 day'
          and c.refreshed_at > (now() - interval '20 hours')
     )
     order by d
     limit 1;

    if v_day is null then
      return;
    end if;

    insert into public.oraculo_olist_order_ref_cache
      (invoice_id, order_ref, channel_label, emission_date, client_document, total_amount, refreshed_at)
    select i.id,
           nullif(i.raw_json->'ecommerce'->>'numeroPedidoEcommerce', ''),
           nullif(i.raw_json->'ecommerce'->>'nome', ''),
           i.emission_date,
           i.client_document,
           i.total_amount,
           now()
      from public.olist_invoices i
     where i.fiscal_invoice_type = 'S'
       and i.emission_date >= v_day
       and i.emission_date < v_day + interval '1 day'
    on conflict (invoice_id) do update
      set order_ref      = excluded.order_ref,
          channel_label  = excluded.channel_label,
          emission_date  = excluded.emission_date,
          client_document= excluded.client_document,
          total_amount   = excluded.total_amount,
          refreshed_at   = excluded.refreshed_at;

    get diagnostics v_count = row_count;
    processed_day := v_day;
    rows_upserted := v_count;
    return next;
  end loop;
end;
$$;

grant execute on function public.refresh_oraculo_olist_order_ref_cache(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Reconciliação com SKU vindo da NF de venda
-- ---------------------------------------------------------------------------

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
         -- SKU Olist só é assumido quando a NF de venda é de SKU único; em
         -- pedido misto fica nulo (não chutar), e a linha aparece como tal.
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
         d.total_value    as return_invoice_value,
         d.match_rank
    from with_sku w
    left join lateral (
      select dv.invoice_id,
             dv.invoice_number,
             dv.emission_date,
             dv.quantity,
             dv.total_value,
             case
               -- SKU da NF de devolução bate com o SKU da NF de venda casada
               when w.sku_olist_resolved is not null
                and upper(btrim(coalesce(dv.sku, ''))) = upper(btrim(w.sku_olist_resolved))
                 then 1
               else 2                            -- só CPF dentro da janela
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
       case
         when m.match_rank = 1 then 'exato'
         when m.match_rank = 2 then 'provavel'
         else 'sem_match'
       end as match_score,
       case
         -- Sem NF de venda casada não dá para afirmar nada sobre a NF de
         -- devolução: seria acusar furo por falta de lastro, não por falha.
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
  'Devolução do canal cruzada com a NF de devolução da Olist. O SKU Olist vem da NF de VENDA casada pelo número do pedido (o SKU do canal só bate em 19% dos casos). flag: sem_nf_venda | sem_nf_devolucao | divergencia_valor | divergencia_qtd.';

grant select on public.oraculo_returns_reconciled to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RPCs — sem_nf_venda separado, e custo pelo SKU resolvido
-- ---------------------------------------------------------------------------

drop function if exists public.oraculo_returns_summary(timestamptz, timestamptz, text);
create function public.oraculo_returns_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null
)
returns table (
  channel text,
  returns_total bigint,
  returns_loss bigint,
  units numeric,
  refund_amount numeric,
  sem_nf_venda_count bigint,
  sem_nf_count bigint,
  sem_nf_amount numeric,
  divergencia_count bigint
)
language sql
stable
as $$
  select r.channel,
         count(*)                                             as returns_total,
         count(*) filter (where r.counts_as_loss)             as returns_loss,
         sum(r.qty) filter (where r.counts_as_loss)           as units,
         sum(r.refund_amount) filter (where r.counts_as_loss) as refund_amount,
         count(*) filter (where r.flag = 'sem_nf_venda')      as sem_nf_venda_count,
         count(*) filter (where r.flag = 'sem_nf_devolucao')  as sem_nf_count,
         sum(r.refund_amount) filter (where r.flag = 'sem_nf_devolucao') as sem_nf_amount,
         count(*) filter (where r.flag in ('divergencia_valor', 'divergencia_qtd')) as divergencia_count
    from public.oraculo_returns_reconciled r
   where r.opened_at >= p_from
     and r.opened_at < p_to
     and (p_channel is null or r.channel = p_channel)
   group by r.channel
   order by 5 desc nulls last;
$$;

drop function if exists public.oraculo_returns_by_sku(timestamptz, timestamptz, text, integer);
create function public.oraculo_returns_by_sku(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null,
  p_limit integer default 100
)
returns table (
  sku text,
  sku_channel text,
  product_name text,
  returns_count bigint,
  units numeric,
  refund_amount numeric,
  unit_cost numeric,
  cost_lost numeric,
  sem_nf_count bigint
)
language sql
stable
as $$
  select coalesce(r.sku_olist_final, r.sku_channel)   as sku,
         min(r.sku_channel)                           as sku_channel,
         min(r.product_name)                          as product_name,
         count(*)                                     as returns_count,
         sum(r.qty)                                   as units,
         sum(r.refund_amount)                         as refund_amount,
         max(uc.unit_cost)                            as unit_cost,
         sum(r.qty) * max(uc.unit_cost)               as cost_lost,
         count(*) filter (where r.flag = 'sem_nf_devolucao') as sem_nf_count
    from public.oraculo_returns_reconciled r
    -- custo é canônico e ancorado no SKU da Olist; por isso o SKU resolvido
    left join public.oraculo_sku_unit_cost uc
      on uc.sku = r.sku_olist_final
   where r.opened_at >= p_from
     and r.opened_at < p_to
     and r.counts_as_loss
     and (p_channel is null or r.channel = p_channel)
   group by 1
   order by 6 desc nulls last
   limit p_limit;
$$;

grant execute on function public.oraculo_returns_summary(timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.oraculo_returns_by_sku(timestamptz, timestamptz, text, integer) to authenticated, service_role;
