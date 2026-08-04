-- Tira o FCP do cálculo da margem fiscal.
--
-- O FCP (Fundo de Combate à Pobreza) é um adicional de ICMS de até 2% que alguns
-- estados cobram sobre produtos considerados supérfluos (bebida alcoólica,
-- cigarro, cosmético, energia, telecom). A coluna `fcp_rate` existe em
-- `oraculo_state_tax_params` desde a migration original da tabela
-- (`20260621230753`) e foi ligada ao cálculo em `20260804160000`, somando ao
-- DIFAL.
--
-- Decisão do negócio (04/08/2026): não se aplica ao portfólio, tirar do cálculo.
-- Estava em 0% nas 27 UFs, então **nenhum número muda** com esta migration.
--
-- A coluna NÃO é removida de propósito: o trigger `calculate_oraculo_state_tax_difal`
-- a usa em `effective_tax_rate`, e manter a coluna zerada deixa a volta atrás
-- barata caso algum estado passe a exigir. O que sai é o uso no motor e o campo
-- na tela — campo que não faz nada foi exatamente o problema que a conexão da
-- /parametros veio resolver.

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
      coalesce(oi.valor_total, 0)::numeric as revenue,
      coalesce(ec.unit_cost, 0)::numeric as raw_unit_cost,
      coalesce(ec.cost_complete, false) as cost_complete,
      case when coalesce(oi.quantidade,0) > 0 then coalesce(oi.valor_total,0) / oi.quantidade else null end as unit_price
    from oraculo_fiscal_invoice_order_links l
    join olist_invoices inv on inv.id = l.invoice_id
    join olist_order_items oi on oi.order_id = l.order_id
    left join olist_products p on p.id = oi.produto_id
    left join oraculo_product_effective_cost ec on ec.product_id = oi.produto_id
    where l.issued_date between p_start and p_end
      and l.order_id is not null
  ),
  base as (
    select
      invoice_id, issued_date, uf, channel_label, sku, produto_id, origin,
      quantity, revenue, unit_price,
      case
        when raw_unit_cost <= 0 then null
        when not cost_complete then null
        when unit_price is not null and raw_unit_cost > unit_price * 3 then null
        else quantity * raw_unit_cost
      end as cost,
      (
        raw_unit_cost <= 0
        or not cost_complete
        or (unit_price is not null and raw_unit_cost > unit_price * 3)
      ) as cost_missing
    from raw
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
      -- PIS/COFINS 9,25% líquido de crédito sobre o custo (null se custo indisponível)
      case when b.cost is null then null
           else greatest(0, b.revenue * 0.0925 - b.cost * 0.0925) end as pis_cofins,
      -- DIFAL = base × max(0, interna_destino − interestadual).
      -- Alíquotas do parâmetro validado quando existir; senão, regra fixa.
      -- Sem FCP: não se aplica ao portfólio (decisão de 04/08/2026).
      b.revenue * greatest(0,
        coalesce(tp.icms_rate, ii.rate, 0)
        - coalesce(tp.interstate_icms_rate,
            case when b.origin = 'importado' then 4
                 when b.uf in ('MG','PR','RJ','RS','SC','SP') then 12
                 else 7 end)
      ) / 100.0 as difal,
      -- Comissão do marketplace: faixa pelo preço unitário, fixo por unidade.
      fee.marketplace_key,
      not coalesce(fee.fee_configured, false) as fee_missing,
      case when fee.fee_configured then
        b.revenue * coalesce(fee.rate, 0) / 100.0 + coalesce(fee.fixed, 0) * b.quantity
      else 0 end as marketplace_fee
    from base b
    left join internal_icms ii on ii.uf = b.uf
    -- Parâmetro da tela /parametros: só conta se validado e vigente na data da
    -- NF. Preferência: origem exata > '*'; fonte 'olist' > '*'; vigência mais recente.
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
    case when cost is null then null else icms + pis_cofins + difal end as taxes_total,
    marketplace_fee, fee_missing,
    case when cost is null then null
         else revenue - cost - icms - pis_cofins - difal - marketplace_fee end as profit
  from calc;
$$;

grant execute on function public.oraculo_fiscal_margin_lines(date, date) to authenticated;

-- Zera o que estiver preenchido, para a coluna não voltar a influenciar nada
-- por engano (hoje já são todas 0).
update public.oraculo_state_tax_params
set fcp_rate = 0
where coalesce(fcp_rate, 0) <> 0;

comment on column public.oraculo_state_tax_params.fcp_rate is
  'DESATIVADO em 04/08/2026: não se aplica ao portfólio. Mantido zerado e fora do cálculo e da tela. Só volta a valer se a migration do motor fiscal voltar a somá-lo ao DIFAL.';
