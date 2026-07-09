-- Camada de margem/ROI fiscal do Oráculo aplicando as regras do app Financeiro
-- (perfil Jacarta, Lucro Real com RET). Espelha packages/domain/fiscal.js, que é
-- coberto por testes. Ver docs/fiscal-financeiro-port.md.
--
-- Fonte por item: NF válida (oraculo_fiscal_invoice_order_links) -> pedido Olist
-- (olist_order_items) -> produto (olist_products, para custo e origem). A UF vem
-- da NF. Cobre apenas NFs com pedido + itens (hoje ~46% da receita); o restante
-- fica fora e é reportado como cobertura.
--
-- Regras aplicadas por item:
--   base            = valor_total do item (receita do item)
--   origem          = payload.origem = '1' -> importado, senão nacional
--   custo           = quantidade * (preco_custo_medio>0 ? preco_custo_medio : preco_custo)
--   ICMS (Jacarta)  = base * (uf=MG ? (importado?14:6) : 1.3)/100
--   PIS/COFINS      = max(0, base*9,25% - custo*9,25%)   (crédito sobre custo)
--   DIFAL           = base * max(0, icms_interno_destino - interestadual)/100
--                     interestadual: importado 4; nacional 12 se UF em Sul/Sudeste, senão 7
--   lucro           = base - custo - ICMS - PIS/COFINS - DIFAL
-- Observações:
--   * taxa de marketplace não entra aqui (Olist não usa faixa Shopee); fica 0.
--   * a regra de custo líquido de importado por transferência (×0,8425) NÃO é
--     aplicada automaticamente por falta da flag de transferência na base atual.

drop function if exists public.oraculo_fiscal_margin_summary(date, date);
drop function if exists public.oraculo_fiscal_sku_margin(date, date, integer);
drop function if exists public.oraculo_fiscal_margin_lines(date, date);

create or replace function public.oraculo_fiscal_margin_lines(p_start date, p_end date)
returns table (
  invoice_id text,
  uf text,
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
  raw as (
    select
      l.invoice_id,
      upper(coalesce(inv.uf, '')) as uf,
      oi.sku,
      oi.produto_id,
      case when (p.payload->>'origem') = '1' then 'importado' else 'nacional' end as origin,
      coalesce(oi.quantidade, 0)::numeric as quantity,
      coalesce(oi.valor_total, 0)::numeric as revenue,
      p.tipo as product_type,
      coalesce(nullif(p.preco_custo_medio, 0), p.preco_custo, 0)::numeric as raw_unit_cost,
      case when coalesce(oi.quantidade,0) > 0 then coalesce(oi.valor_total,0) / oi.quantidade else null end as unit_price
    from oraculo_fiscal_invoice_order_links l
    join olist_invoices inv on inv.id = l.invoice_id
    join olist_order_items oi on oi.order_id = l.order_id
    left join olist_products p on p.id = oi.produto_id
    where l.issued_date between p_start and p_end
      and l.order_id is not null
  ),
  base as (
    -- Sanidade de custo: kits (tipo K) e custos implausíveis (> 3x o preço de
    -- venda unitário) não têm custo confiável na Olist -> custo indisponível.
    select
      invoice_id, uf, sku, produto_id, origin, quantity, revenue,
      case
        when product_type = 'K' then null
        when raw_unit_cost <= 0 then null
        when unit_price is not null and raw_unit_cost > unit_price * 3 then null
        else quantity * raw_unit_cost
      end as cost,
      (
        product_type = 'K'
        or raw_unit_cost <= 0
        or (unit_price is not null and raw_unit_cost > unit_price * 3)
      ) as cost_missing
    from raw
  ),
  calc as (
    select
      b.*,
      -- ICMS de saída (matriz Jacarta), sobre a receita
      b.revenue * (case
        when b.uf = 'MG' then (case when b.origin = 'importado' then 14 else 6 end)
        else 1.3 end) / 100.0 as icms,
      -- PIS/COFINS 9,25% líquido de crédito sobre o custo (null se custo indisponível)
      case when b.cost is null then null
           else greatest(0, b.revenue * 0.0925 - b.cost * 0.0925) end as pis_cofins,
      -- DIFAL = base * max(0, interna_destino - interestadual)
      b.revenue * greatest(0,
        coalesce(ii.rate, 0)
        - (case when b.origin = 'importado' then 4
                when b.uf in ('MG','PR','RJ','RS','SC','SP') then 12
                else 7 end)
      ) / 100.0 as difal
    from base b
    left join internal_icms ii on ii.uf = b.uf
  )
  select
    invoice_id, uf, sku, produto_id, origin, quantity, revenue, cost, cost_missing,
    icms, pis_cofins, difal,
    case when cost is null then null else icms + pis_cofins + difal end as taxes_total,
    case when cost is null then null else revenue - cost - icms - pis_cofins - difal end as profit
  from calc;
$$;

-- Agregado por SKU no período (para /skus).
create or replace function public.oraculo_fiscal_sku_margin(p_start date, p_end date, p_limit integer default 200)
returns table (
  sku text,
  units numeric,
  revenue numeric,
  cost numeric,
  icms numeric,
  pis_cofins numeric,
  difal numeric,
  taxes_total numeric,
  profit numeric,
  margin_rate numeric,
  roi numeric,
  cost_missing_lines bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sku,
    sum(quantity) as units,
    sum(revenue) as revenue,
    sum(cost) as cost,
    sum(icms) as icms,
    sum(pis_cofins) as pis_cofins,
    sum(difal) as difal,
    sum(taxes_total) as taxes_total,
    sum(profit) as profit,
    case when sum(revenue) > 0 then sum(profit) / sum(revenue) else null end as margin_rate,
    case when sum(cost) > 0 then sum(profit) / sum(cost) else null end as roi,
    count(*) filter (where cost_missing) as cost_missing_lines
  from public.oraculo_fiscal_margin_lines(p_start, p_end)
  where cost is not null
  group by sku
  order by revenue desc
  limit greatest(1, coalesce(p_limit, 200));
$$;

-- Resumo do período + cobertura (para o dashboard).
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
      sum(pis_cofins) as total_pis_cofins,
      sum(difal) filter (where cost is not null) as total_difal,
      sum(taxes_total) as total_taxes,
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
    a.total_cost, a.total_icms, a.total_pis_cofins, a.total_difal, a.total_taxes, a.total_profit,
    case when a.revenue_with_cost > 0 then a.total_profit / a.revenue_with_cost else null end as margin_rate,
    case when a.total_cost > 0 then a.total_profit / a.total_cost else null end as roi,
    o.inv as official_valid_invoices,
    o.rev as official_valid_revenue,
    case when o.rev > 0 then round(100.0 * a.revenue_with_item / o.rev, 2) else 0 end as coverage_item_revenue_pct,
    case when o.rev > 0 then round(100.0 * a.revenue_with_cost / o.rev, 2) else 0 end as coverage_cost_revenue_pct
  from agg a cross join official o;
$$;

grant execute on function public.oraculo_fiscal_margin_lines(date, date) to authenticated;
grant execute on function public.oraculo_fiscal_sku_margin(date, date, integer) to authenticated;
grant execute on function public.oraculo_fiscal_margin_summary(date, date) to authenticated;
