-- Corrige um falso positivo de 'divergencia_valor' que atingia 327 das 1.090
-- devoluções (30%) — quase um terço da tela apontaria erro onde não há.
--
-- Causa: a comparação usava olist_invoice_items.total_value (valor do ITEM,
-- que carrega o preço cheio do produto) em vez de olist_invoices.total_amount
-- (valor efetivo da NF). Amostra medida:
--
--   estorno TikTok | total_value do item | total_amount da NF
--        39,90     |        69,90        |      39,90
--        41,20     |        79,90        |      41,20
--        25,94     |        79,90        |      25,94
--        58,76     |        79,90        |      58,76
--
-- A mediana da razão era exatamente 2,003 — o cheiro de erro sistemático, não
-- de divergência real. Contra o total_amount o valor bate na casa do centavo,
-- o que de quebra confirma que o casamento por CPF está correto.
--
-- Correção: comparar contra o valor da NF. O valor do item continua exposto
-- (return_invoice_item_value) porque é útil para conferência manual.

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
         d.total_amount   as return_invoice_value,       -- valor da NF (o correto)
         d.total_value    as return_invoice_item_value,  -- valor do item (conferência)
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
  'Devolução do canal cruzada com a NF de devolução da Olist. SKU Olist vem da NF de VENDA casada pelo número do pedido (o SKU do canal só bate em 19%). Valor compara contra total_amount da NF, nunca contra total_value do item (preço cheio). flag: sem_nf_venda | sem_nf_devolucao | divergencia_valor | divergencia_qtd.';

grant select on public.oraculo_returns_reconciled to authenticated, service_role;
