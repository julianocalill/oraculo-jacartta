-- Motor fiscal passa a calcular imposto como a NF calcula.
--
-- Quatro mudanças, todas decididas em 04/08/2026 a partir da análise da NF real
-- 533740 (Shopee, MG→RJ, SKU 212961) contra o que o motor produzia:
--
-- 1) BASE = VALOR FATURADO NA NF, não o valor do pedido. 30% das NFs de 01/08
--    divergem do pedido (cupom do vendedor fica no pedido pelo preço cheio; a
--    NF sai pelo valor pago) — receita estava inflada 6,95% no dia. Como o item
--    da NF não serve de base direta (kit do pedido vira componentes na NF, e o
--    item da NF também carrega preço cheio com o desconto só no total), o
--    valor fiscal da NF (fiscal_amount = vNF) é RATEADO pelas linhas do pedido
--    proporcionalmente ao valor de cada item. O rateio também conserta pedido
--    com duas NFs, que antes contava a receita em dobro.
--
-- 2) CUSTO NÃO ENTRA EM IMPOSTO (decisão do negócio: custo é gestão interna).
--    O PIS/COFINS era max(0, base×9,25% − custo×9,25%); vira débito bruto
--    base×9,25%, como a NF destaca (CST 01). Consequência: os impostos da
--    linha não dependem mais do custo — só o LUCRO continua exigindo custo.
--
-- 3) DIFAL NÃO EXISTE DENTRO DE MG (venda intraestadual). Resolve a ressalva
--    nº 1 do doc de explicação: MG→MG pagava 6/14% de DIFAL indevido.
--
-- 4) DIFAL "POR DENTRO" (base única, LC 190/2022), exatamente como a NF:
--      base_destino = vNF / (1 − interna);  difal = base_destino × interna − vNF × interestadual
--    NF 533740: 44,51/0,78 = 57,06 × 22% − 44,51 × 12% = 7,21. O motor antigo
--    (sem gross-up) dava 4,45 — subestimava ~40%.
--
-- Espelho em JS: calcDifalPorDentro / calcPisCofins(creditEnabled:false) em
-- packages/domain/fiscal.js, com a NF 533740 como caso de teste.

create or replace function public.oraculo_fiscal_margin_lines(p_start date, p_end date)
returns table (
  invoice_id text,
  uf text,
  channel_label text,
  marketplace_key text,
  sku text,
  produto_id text,
  origin text,
  quantity numeric,
  revenue numeric,
  cost numeric,
  cost_missing boolean,
  icms numeric,
  pis_cofins numeric,
  difal numeric,
  taxes_total numeric,
  marketplace_fee numeric,
  fee_missing boolean,
  profit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  -- Fallback: alíquota interna do destino quando não há parâmetro validado.
  with internal_icms(uf, rate) as (
    values ('AC',19),('AL',20),('AP',18),('AM',20),('BA',20.5),('CE',20),('DF',20),
           ('ES',17),('GO',19),('MA',22),('MT',17),('MS',17),('MG',18),('PA',19),
           ('PB',20),('PR',19.5),('PE',20.5),('PI',21),('RJ',22),('RN',20),('RS',17),
           ('RO',19.5),('RR',20),('SC',17),('SP',18),('SE',19),('TO',20)
  ),
  -- Faixas de comissão achatadas: uma linha por degrau.
  fee_tiers as (
    select
      p.marketplace_key,
      p.match_pattern,
      p.match_priority,
      p.fee_configured,
      x.ord,
      case when x.tier->>'max' is null then null else (x.tier->>'max')::numeric end as max_price,
      coalesce((x.tier->>'rate')::numeric, 0) as rate,
      coalesce((x.tier->>'fixed')::numeric, 0) as fixed
    from oraculo_marketplace_fee_params p
    cross join lateral jsonb_array_elements(p.tiers) with ordinality as x(tier, ord)
  ),
  raw as (
    select
      l.invoice_id,
      l.issued_date,
      upper(coalesce(inv.uf, '')) as uf,
      coalesce(inv.fiscal_channel_label, 'Sem canal') as channel_label,
      oi.sku,
      oi.produto_id,
      case when (p.payload->>'origem') = '1' then 'importado' else 'nacional' end as origin,
      coalesce(oi.quantidade, 0)::numeric as quantity,
      coalesce(oi.valor_total, 0)::numeric as order_value,
      coalesce(inv.fiscal_amount, 0)::numeric as invoice_total,
      sum(coalesce(oi.valor_total, 0)::numeric) over (partition by l.invoice_id) as invoice_order_sum,
      coalesce(ec.unit_cost, 0)::numeric as raw_unit_cost,
      coalesce(ec.cost_complete, false) as cost_complete
    from oraculo_fiscal_invoice_order_links l
    join olist_invoices inv on inv.id = l.invoice_id
    join olist_order_items oi on oi.order_id = l.order_id
    left join olist_products p on p.id = oi.produto_id
    left join oraculo_product_effective_cost ec on ec.product_id = oi.produto_id
    where l.issued_date between p_start and p_end
      and l.order_id is not null
  ),
  priced as (
    -- Receita da linha = vNF rateado pela participação do item no pedido.
    -- Sem vNF (ou pedido zerado), cai no valor do pedido como antes.
    select
      raw.*,
      case when invoice_total > 0 and invoice_order_sum > 0
           then invoice_total * order_value / invoice_order_sum
           else order_value end as revenue
    from raw
  ),
  base as (
    select
      invoice_id, issued_date, uf, channel_label, sku, produto_id, origin,
      quantity, revenue,
      case when quantity > 0 then revenue / quantity else null end as unit_price,
      case
        when raw_unit_cost <= 0 then null
        when not cost_complete then null
        when quantity > 0 and raw_unit_cost > (revenue / quantity) * 3 then null
        else quantity * raw_unit_cost
      end as cost,
      (
        raw_unit_cost <= 0
        or not cost_complete
        or (quantity > 0 and raw_unit_cost > (revenue / quantity) * 3)
      ) as cost_missing
    from priced
  ),
  calc as (
    select
      b.*,
      -- ICMS de saída: parâmetro validado da UF/origem, senão matriz Jacarta.
      b.revenue * coalesce(
        tp.outbound_icms_rate,
        case when b.uf = 'MG' then (case when b.origin = 'importado' then 14 else 6 end)
             else 1.3 end
      ) / 100.0 as icms,
      -- PIS/COFINS: débito bruto 9,25% sobre a base NF (custo não entra em imposto).
      b.revenue * 0.0925 as pis_cofins,
      -- DIFAL: só interestadual (MG→MG = 0); base única "por dentro" como a NF.
      case when b.uf = 'MG' then 0 else
        greatest(0,
          case when coalesce(tp.icms_rate, ii.rate, 0) <= 0
                 or coalesce(tp.icms_rate, ii.rate, 0) >= 100 then 0
               else b.revenue / (1 - coalesce(tp.icms_rate, ii.rate) / 100.0)
                    * (coalesce(tp.icms_rate, ii.rate) / 100.0) end
          - b.revenue * coalesce(tp.interstate_icms_rate,
              case when b.origin = 'importado' then 4
                   when b.uf in ('PR','RJ','RS','SC','SP') then 12
                   else 7 end) / 100.0
        )
      end as difal,
      -- Comissão do marketplace: faixa pelo preço unitário FATURADO, fixo por unidade.
      fee.marketplace_key,
      not coalesce(fee.fee_configured, false) as fee_missing,
      case when fee.fee_configured then
        b.revenue * coalesce(fee.rate, 0) / 100.0 + coalesce(fee.fixed, 0) * b.quantity
      else 0 end as marketplace_fee
    from base b
    left join internal_icms ii on ii.uf = b.uf
    -- Parâmetro da tela /parametros: só conta se validado e vigente na data da NF.
    left join lateral (
      select p.icms_rate, p.interstate_icms_rate, p.outbound_icms_rate
      from oraculo_state_tax_params p
      where p.params_configured
        and p.uf = b.uf
        and p.operation_type = 'venda_consumidor'
        and p.applies_to_source in ('*', 'olist')
        and p.merchandise_origin in ('*', b.origin)
        and p.valid_from <= b.issued_date
        and (p.valid_to is null or p.valid_to >= b.issued_date)
      order by
        case when p.merchandise_origin = b.origin then 0 else 1 end,
        case when p.applies_to_source = 'olist' then 0 else 1 end,
        p.valid_from desc
      limit 1
    ) tp on true
    left join lateral (
      select ft.marketplace_key, ft.rate, ft.fixed, ft.fee_configured
      from fee_tiers ft
      where b.channel_label ilike ft.match_pattern
        and (ft.max_price is null or coalesce(b.unit_price, b.revenue) <= ft.max_price)
      order by ft.match_priority, ft.ord
      limit 1
    ) fee on true
  )
  select
    invoice_id, uf, channel_label, marketplace_key, sku, produto_id, origin,
    quantity, revenue, cost, cost_missing,
    icms, pis_cofins, difal,
    -- Impostos não dependem mais do custo — sempre calculados.
    icms + pis_cofins + difal as taxes_total,
    marketplace_fee, fee_missing,
    case when cost is null then null
         else revenue - cost - icms - pis_cofins - difal - marketplace_fee end as profit
  from calc;
$$;

grant execute on function public.oraculo_fiscal_margin_lines(date, date) to authenticated;

-- Resumo: os impostos por linha agora existem mesmo sem custo, então TODAS as
-- somas de imposto passam a filtrar pela base coberta (cost is not null), para
-- os cards continuarem coerentes com "Receita com custo".
create or replace function public.oraculo_fiscal_margin_summary(p_start date, p_end date)
returns table (
  invoices_with_item bigint,
  revenue_with_item numeric,
  invoices_with_cost bigint,
  revenue_with_cost numeric,
  total_cost numeric,
  total_icms numeric,
  total_pis_cofins numeric,
  total_difal numeric,
  total_taxes numeric,
  total_marketplace_fee numeric,
  revenue_without_fee_params numeric,
  total_profit numeric,
  margin_rate numeric,
  roi numeric,
  official_valid_invoices bigint,
  official_valid_revenue numeric,
  coverage_item_revenue_pct numeric,
  coverage_cost_revenue_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select * from public.oraculo_fiscal_margin_lines(p_start, p_end)
  ),
  agg as (
    select
      count(distinct invoice_id) as invoices_with_item,
      sum(revenue) as revenue_with_item,
      count(distinct invoice_id) filter (where cost is not null) as invoices_with_cost,
      sum(revenue) filter (where cost is not null) as revenue_with_cost,
      sum(cost) as total_cost,
      sum(icms) filter (where cost is not null) as total_icms,
      sum(pis_cofins) filter (where cost is not null) as total_pis_cofins,
      sum(difal) filter (where cost is not null) as total_difal,
      sum(taxes_total) filter (where cost is not null) as total_taxes,
      sum(marketplace_fee) filter (where cost is not null) as total_marketplace_fee,
      sum(revenue) filter (where cost is not null and fee_missing) as revenue_without_fee_params,
      sum(profit) as total_profit
    from lines
  ),
  official as (
    select count(*) as inv, coalesce(sum(billed_revenue),0) as rev
    from oraculo_fiscal_invoices_valid
    where issued_date between p_start and p_end
  )
  select
    a.invoices_with_item,
    a.revenue_with_item,
    a.invoices_with_cost,
    a.revenue_with_cost,
    a.total_cost, a.total_icms, a.total_pis_cofins, a.total_difal, a.total_taxes,
    coalesce(a.total_marketplace_fee, 0) as total_marketplace_fee,
    coalesce(a.revenue_without_fee_params, 0) as revenue_without_fee_params,
    a.total_profit,
    case when a.revenue_with_cost > 0 then a.total_profit / a.revenue_with_cost else null end as margin_rate,
    case when a.total_cost > 0 then a.total_profit / a.total_cost else null end as roi,
    o.inv as official_valid_invoices,
    o.rev as official_valid_revenue,
    case when o.rev > 0 then round(100.0 * a.revenue_with_item / o.rev, 2) else 0 end as coverage_item_revenue_pct,
    case when o.rev > 0 then round(100.0 * a.revenue_with_cost / o.rev, 2) else 0 end as coverage_cost_revenue_pct
  from agg a cross join official o;
$$;

grant execute on function public.oraculo_fiscal_margin_summary(date, date) to authenticated;

-- Regrava o snapshot já com o motor novo (o cron horário mantém depois).
select public.oraculo_capture_fiscal_margin_snapshots();
