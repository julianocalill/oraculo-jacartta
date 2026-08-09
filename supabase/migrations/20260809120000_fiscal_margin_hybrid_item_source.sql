-- Auditoria fiscal de 09/08/2026: a margem usava somente o item do pedido,
-- embora o item fiscal da NF já estivesse hidratado em milhares de NFs sem
-- o detalhe do pedido. Isso deixava a margem com cobertura menor do que a
-- cobertura fiscal mostrada no dashboard.
--
-- Nova precedência por NF:
--   1. item do pedido, quando existe (preserva o SKU comercial e o kit);
--   2. item fiscal da NF como fallback (produto/componente e quantidade reais).
--
-- A receita continua sendo o vNF rateado pelas linhas. O fallback não usa o
-- total_value do item como receita final: ele serve apenas de peso para o
-- rateio, porque o desconto da venda fica no cabeçalho da NF.
--
-- A função também passa a partir explicitamente de
-- oraculo_fiscal_invoices_valid. Um link residual para uma NF status 3 estava
-- entrando na margem porque a versão anterior voltava à tabela bruta.

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
  with internal_icms(uf, rate) as (
    values ('AC',19),('AL',20),('AP',18),('AM',20),('BA',20.5),('CE',20),('DF',20),
           ('ES',17),('GO',19),('MA',22),('MT',17),('MS',17),('MG',18),('PA',19),
           ('PB',20),('PR',19.5),('PE',20.5),('PI',21),('RJ',22),('RN',20),('RS',17),
           ('RO',19.5),('RR',20),('SC',17),('SP',18),('SE',19),('TO',20)
  ),
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
  valid_invoices as materialized (
    select id, issued_date, upper(coalesce(uf, '')) as uf,
           coalesce(channel_label, 'Sem canal') as channel_label,
           coalesce(billed_revenue, 0)::numeric as invoice_total
    from public.oraculo_fiscal_invoices_valid
    where issued_date between p_start and p_end
  ),
  order_item_invoices as materialized (
    select distinct l.invoice_id
    from public.oraculo_fiscal_invoice_order_links l
    join valid_invoices inv on inv.id = l.invoice_id
    join public.olist_order_items oi on oi.order_id = l.order_id
  ),
  source_lines as (
    -- Fonte preferencial: item comercial do pedido.
    select
      inv.id as invoice_id,
      inv.issued_date,
      inv.uf,
      inv.channel_label,
      inv.invoice_total,
      oi.sku,
      oi.produto_id,
      coalesce(oi.quantidade, 0)::numeric as quantity,
      coalesce(oi.valor_total, 0)::numeric as line_weight,
      'order_item'::text as item_source
    from valid_invoices inv
    join public.oraculo_fiscal_invoice_order_links l on l.invoice_id = inv.id
    join public.olist_order_items oi on oi.order_id = l.order_id

    union all

    -- Fallback: item fiscal, somente se a NF não possui item de pedido.
    select
      inv.id as invoice_id,
      inv.issued_date,
      inv.uf,
      inv.channel_label,
      inv.invoice_total,
      ii.sku,
      ii.product_id as produto_id,
      coalesce(ii.quantity, 0)::numeric as quantity,
      coalesce(ii.total_value, 0)::numeric as line_weight,
      'invoice_item'::text as item_source
    from valid_invoices inv
    join public.olist_invoice_items ii on ii.invoice_id = inv.id
    where not exists (
      select 1 from order_item_invoices oi where oi.invoice_id = inv.id
    )
  ),
  raw as (
    select
      s.*,
      case when (p.payload->>'origem') = '1' then 'importado' else 'nacional' end as origin,
      sum(s.line_weight) over (partition by s.invoice_id) as invoice_line_sum,
      count(*) over (partition by s.invoice_id) as invoice_line_count,
      coalesce(ec.unit_cost, 0)::numeric as raw_unit_cost,
      coalesce(ec.cost_complete, false) as cost_complete
    from source_lines s
    left join public.olist_products p on p.id = s.produto_id
    left join public.oraculo_product_effective_cost ec on ec.product_id = s.produto_id
  ),
  priced as (
    select
      raw.*,
      case
        when invoice_total > 0 and invoice_line_sum > 0
          then invoice_total * line_weight / invoice_line_sum
        when invoice_total > 0 and invoice_line_count > 0
          then invoice_total / invoice_line_count
        -- A margem segue o mesmo contrato da receita oficial. NF válida com
        -- vNF zero não pode reaparecer pelo valor do pedido/item.
        else 0
      end as revenue
    from raw
  ),
  base as (
    select
      invoice_id, issued_date, uf, channel_label, invoice_total,
      sku, produto_id, origin, item_source,
      quantity, revenue,
      case when quantity > 0 then revenue / quantity else null end as unit_price,
      case
        when raw_unit_cost <= 0 then null
        when not cost_complete then null
        when quantity <= 0 then null
        when raw_unit_cost > (revenue / quantity) * 3 then null
        else quantity * raw_unit_cost
      end as cost,
      (
        raw_unit_cost <= 0
        or not cost_complete
        or quantity <= 0
        or (quantity > 0 and raw_unit_cost > (revenue / quantity) * 3)
      ) as cost_missing
    from priced
  ),
  calc as (
    select
      b.*,
      b.revenue * coalesce(
        tp.outbound_icms_rate,
        case when b.uf = 'MG' then (case when b.origin = 'importado' then 14 else 6 end)
             else 1.3 end
      ) / 100.0 as icms,
      b.revenue * 0.0925 as pis_cofins,
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
      fee.marketplace_key,
      not coalesce(fee.fee_configured, false) as fee_missing,
      case when fee.fee_configured then
        b.revenue * coalesce(fee.rate, 0) / 100.0
        + case
            -- O item fiscal de um kit é aberto em componentes. A taxa fixa é
            -- do item comercial, não de cada componente; no fallback ela
            -- incide uma vez por NF e é rateada pela receita das linhas.
            when b.item_source = 'invoice_item' and b.invoice_total > 0
              then coalesce(fee.fixed, 0) * b.revenue / b.invoice_total
            when b.item_source = 'invoice_item'
              then 0
            else coalesce(fee.fixed, 0) * b.quantity
          end
      else 0 end as marketplace_fee
    from base b
    left join internal_icms ii on ii.uf = b.uf
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
        and (
          ft.max_price is null
          or case when b.item_source = 'invoice_item'
                  then b.invoice_total
                  else coalesce(b.unit_price, b.revenue)
             end <= ft.max_price
        )
      order by ft.match_priority, ft.ord
      limit 1
    ) fee on true
  )
  select
    invoice_id, uf, channel_label, marketplace_key, sku, produto_id, origin,
    quantity, revenue, cost, cost_missing,
    icms, pis_cofins, difal,
    icms + pis_cofins + difal as taxes_total,
    marketplace_fee, fee_missing,
    case when cost is null then null
         else revenue - cost - icms - pis_cofins - difal - marketplace_fee end as profit
  from calc;
$$;

grant execute on function public.oraculo_fiscal_margin_lines(date, date) to authenticated;

-- Atualiza imediatamente o snapshot do mês; o cron horário mantém depois.
select public.oraculo_capture_fiscal_margin_snapshots();
