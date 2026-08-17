-- Custo do produto passa a ser LIQUIDO dos creditos recuperaveis (14/08/2026).
--
--   nacional  -> custo x (1 - 9,25%)    PIS/COFINS nao cumulativo sobre a entrada
--   importado -> custo x (1 - 11,75%)   PIS/COFINS-Importacao (2,1% + 9,65%)
--
-- Regra do negocio: o custo bruto do ERP superestima o desembolso real, porque
-- parte dele volta como credito na apuracao. O motor passa a medir o custo que
-- de fato fica.
--
-- OBSERVACAO CONTABIL: em 04/08 o credito de PIS/COFINS saiu do calculo do
-- imposto ("custo e gestao interna, nao entra em imposto"). Ele volta agora pelo
-- lado do custo. O efeito no lucro e identico -- o que muda e a leitura: o
-- imposto continua sendo o debito bruto que a NF destaca, e o custo passa a ser
-- o liquido. Nao ha dupla contagem: o credito aparece uma vez so.
--
-- A regra vive em UMA funcao (`oraculo_net_cost`) usada pelas tres views que
-- resolvem custo, para nao poder divergir:
--   1. oraculo_product_effective_cost -> motor fiscal (margem/ROI fiscais, /skus)
--   2. oraculo_sku_unit_cost          -> Shopee, Mercado Livre, devolucoes
--   3. oraculo_sku_margin_30d         -> margem/ROI operacionais de /skus
--
-- Importado por transferencia: o porte do Financeiro previa 15,75% (4% de ICMS
-- + 11,75%). Decisao de 14/08/2026: usar so os 11,75%, porque a base nao tem a
-- flag que identifica a entrada por transferencia e o ICMS de importacao nem
-- sempre gera credito recuperavel no regime da Jacartta.

create or replace function public.oraculo_net_cost_rate(p_origin text)
returns numeric
language sql
immutable
parallel safe
as $$
  select case when lower(coalesce(p_origin, '')) like 'import%' then 0.1175 else 0.0925 end;
$$;

comment on function public.oraculo_net_cost_rate(text) is
  'Credito recuperavel sobre o custo de aquisicao: 11,75% importado, 9,25% nacional.';

create or replace function public.oraculo_net_cost(p_gross numeric, p_origin text)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
           when p_gross is null then null
           else greatest(0, p_gross * (1 - public.oraculo_net_cost_rate(p_origin)))
         end;
$$;

comment on function public.oraculo_net_cost(numeric, text) is
  'Custo liquido de creditos recuperaveis. Nunca negativo. Null entra, null sai.';

-- 1) Custo efetivo por produto -------------------------------------------------
-- Kits somam o custo LIQUIDO de cada componente, com a origem do proprio
-- componente (um kit pode misturar nacional e importado). `unit_cost` continua
-- sendo a coluna que o motor fiscal le, agora ja liquida; `unit_cost_gross`
-- entra no fim para auditoria.
create or replace view public.oraculo_product_effective_cost
with (security_invoker = false) as
with product_origin as (
  select
    id,
    case when (payload->>'origem') = '1' then 'importado' else 'nacional' end as origin
  from olist_products
),
kit_cost as (
  select
    k.id as kit_id,
    sum(
      (comp->>'quantidade')::numeric
      * public.oraculo_net_cost(
          coalesce(nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0),
          po.origin
        )
    ) as unit_cost,
    sum(
      (comp->>'quantidade')::numeric
      * coalesce(nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0)
    ) as unit_cost_gross,
    bool_and(coalesce(nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0) > 0) as all_costed
  from olist_products k
  cross join lateral jsonb_array_elements(coalesce(k.payload->'kit', '[]'::jsonb)) comp
  left join olist_products sp on sp.id = (comp->'produto'->>'id')
  left join product_origin po on po.id = sp.id
  where k.tipo = 'K'
  group by k.id
)
select
  p.id as product_id,
  p.sku,
  p.tipo,
  case when p.tipo = 'K' then kc.unit_cost
       else public.oraculo_net_cost(
              coalesce(nullif(p.preco_custo_medio, 0), p.preco_custo, 0),
              po.origin
            ) end as unit_cost,
  case when p.tipo = 'K' then coalesce(kc.all_costed, false) else true end as cost_complete,
  case when p.tipo = 'K' then 'kit_components' else 'product' end as cost_source,
  case when p.tipo = 'K' then kc.unit_cost_gross
       else coalesce(nullif(p.preco_custo_medio, 0), p.preco_custo, 0) end as unit_cost_gross
from olist_products p
left join kit_cost kc on kc.kit_id = p.id
left join product_origin po on po.id = p.id;

grant select on public.oraculo_product_effective_cost to authenticated;

-- 2) Resolvedor por SKU --------------------------------------------------------
-- Mesma cadeia de prioridade de 16/07 (override > olist_products > kits), agora
-- com o custo liquido em todos os degraus. O override manual e tratado como
-- custo de aquisicao BRUTO: quem digita informa o que pagou, o motor desconta o
-- credito -- assim a regra e a mesma venha o numero de onde vier.
create or replace view public.oraculo_sku_unit_cost as
with sku_origin as (
  select
    sku,
    case when bool_or((payload->>'origem') = '1') then 'importado' else 'nacional' end as origin
  from public.olist_products
  where sku is not null
  group by sku
)
select distinct on (sku) sku, unit_cost, cost_source, unit_cost_gross
from (
  select sp.sku,
         public.oraculo_net_cost(sp.unit_cost_override, so.origin) as unit_cost,
         1 as prio,
         'override:' || sp.source as cost_source,
         sp.unit_cost_override as unit_cost_gross
    from public.oraculo_margin_sku_params sp
    left join sku_origin so on so.sku = sp.sku
   where sp.active
     and sp.unit_cost_override is not null
     and sp.unit_cost_override > 0
  union all
  select p.sku,
         public.oraculo_net_cost(
           max(coalesce(nullif(p.preco_custo_medio, 0), nullif(p.preco_custo, 0))),
           max(so.origin)
         ) as unit_cost,
         2 as prio,
         'olist_products' as cost_source,
         max(coalesce(nullif(p.preco_custo_medio, 0), nullif(p.preco_custo, 0))) as unit_cost_gross
    from public.olist_products p
    join sku_origin so on so.sku = p.sku
   where p.sku is not null
     and p.tipo is distinct from 'K'
     and coalesce(nullif(p.preco_custo_medio, 0), nullif(p.preco_custo, 0)) > 0
   group by p.sku
  union all
  select c.sku,
         c.unit_cost,
         3 as prio,
         'effective_cost' as cost_source,
         c.unit_cost_gross
    from public.oraculo_product_effective_cost c
   where c.sku is not null
     and c.unit_cost > 0
) x
order by sku, prio;

grant select on public.oraculo_sku_unit_cost to authenticated, service_role;

-- 3) Margem/ROI operacionais 30d ----------------------------------------------
-- Copia da view de 20260620130000 com dois pontos alterados: o custo da Olist e
-- o override manual passam pela mesma funcao de credito. O resto do corpo e
-- identico.
create or replace view public.oraculo_sku_margin_30d
with (security_invoker = true)
as
with sku_origin as (
  select
    sku,
    case when bool_or((payload->>'origem') = '1') then 'importado' else 'nacional' end as origin
  from public.olist_products
  where sku is not null
  group by sku
),
olist_costs as (
  select
    'olist'::text as source,
    p.sku,
    public.oraculo_net_cost(
      max(coalesce(p.preco_custo_medio, p.preco_custo)),
      max(so.origin)
    ) as source_unit_cost
  from public.olist_products p
  join sku_origin so on so.sku = p.sku
  where p.sku is not null
    and p.tipo is distinct from 'K'
  group by p.sku
),
current_skus as (
  select
    c.source,
    c.sku,
    c.product_name,
    c.status_label,
    c.units_30d,
    c.revenue_30d,
    c.units_prev_30d,
    c.revenue_prev_30d,
    c.revenue_change_pct,
    c.available_stock,
    c.stock_balance,
    c.days_until_stockout,
    c.last_sale_at,
    coalesce(
      public.oraculo_net_cost(sp.unit_cost_override, so.origin),
      oc.source_unit_cost
    ) as unit_cost,
    coalesce(sp.target_margin_rate_override, cp.target_margin_rate) as target_margin_rate,
    coalesce(sp.minimum_margin_rate_override, cp.minimum_margin_rate) as minimum_margin_rate,
    cp.tax_rate,
    cp.marketplace_fee_rate,
    cp.payment_fee_rate,
    cp.freight_subsidy_per_unit,
    cp.packaging_cost_per_unit,
    cp.params_configured
  from public.oraculo_sku_current_unified c
  left join olist_costs oc
    on oc.source = c.source
   and oc.sku = c.sku
  left join sku_origin so
    on so.sku = c.sku
  left join public.oraculo_margin_channel_params cp
    on cp.source = c.source
   and cp.channel_key = '*'
  left join public.oraculo_margin_sku_params sp
    on sp.source = c.source
   and sp.sku = c.sku
   and sp.active
)
select
  source,
  sku,
  product_name,
  status_label,
  units_30d,
  revenue_30d,
  units_prev_30d,
  revenue_prev_30d,
  revenue_change_pct,
  available_stock,
  stock_balance,
  days_until_stockout,
  last_sale_at,
  unit_cost,
  target_margin_rate,
  minimum_margin_rate,
  tax_rate,
  marketplace_fee_rate,
  payment_fee_rate,
  freight_subsidy_per_unit,
  packaging_cost_per_unit,
  params_configured,
  case
    when unit_cost is null or unit_cost <= 0 then null::numeric
    else unit_cost * coalesce(units_30d, 0)
  end as product_cost_30d,
  coalesce(revenue_30d, 0) * (
    coalesce(tax_rate, 0)
    + coalesce(marketplace_fee_rate, 0)
    + coalesce(payment_fee_rate, 0)
  ) as fee_cost_30d,
  coalesce(units_30d, 0) * (
    coalesce(freight_subsidy_per_unit, 0)
    + coalesce(packaging_cost_per_unit, 0)
  ) as operational_cost_30d,
  case
    when unit_cost is null or unit_cost <= 0 then null::numeric
    else coalesce(revenue_30d, 0)
      - (unit_cost * coalesce(units_30d, 0))
      - (coalesce(revenue_30d, 0) * (
          coalesce(tax_rate, 0)
          + coalesce(marketplace_fee_rate, 0)
          + coalesce(payment_fee_rate, 0)
        ))
      - (coalesce(units_30d, 0) * (
          coalesce(freight_subsidy_per_unit, 0)
          + coalesce(packaging_cost_per_unit, 0)
        ))
  end as margin_amount_30d,
  case
    when coalesce(revenue_30d, 0) <= 0 then null::numeric
    when unit_cost is null or unit_cost <= 0 then null::numeric
    else (
      coalesce(revenue_30d, 0)
      - (unit_cost * coalesce(units_30d, 0))
      - (coalesce(revenue_30d, 0) * (
          coalesce(tax_rate, 0)
          + coalesce(marketplace_fee_rate, 0)
          + coalesce(payment_fee_rate, 0)
        ))
      - (coalesce(units_30d, 0) * (
          coalesce(freight_subsidy_per_unit, 0)
          + coalesce(packaging_cost_per_unit, 0)
        ))
    ) / nullif(revenue_30d, 0)
  end as margin_rate_30d,
  case
    when unit_cost is null or unit_cost <= 0 or coalesce(units_30d, 0) <= 0 then null::numeric
    else (
      coalesce(revenue_30d, 0)
      - (unit_cost * coalesce(units_30d, 0))
      - (coalesce(revenue_30d, 0) * (
          coalesce(tax_rate, 0)
          + coalesce(marketplace_fee_rate, 0)
          + coalesce(payment_fee_rate, 0)
        ))
      - (coalesce(units_30d, 0) * (
          coalesce(freight_subsidy_per_unit, 0)
          + coalesce(packaging_cost_per_unit, 0)
        ))
    ) / nullif(unit_cost * coalesce(units_30d, 0), 0)
  end as roi_30d,
  case
    when coalesce(revenue_30d, 0) <= 0 then 'sem_venda'
    when not coalesce(params_configured, false) then 'configurar_parametros'
    when unit_cost is null or unit_cost <= 0 then 'sem_custo'
    when (
      coalesce(revenue_30d, 0)
      - (unit_cost * coalesce(units_30d, 0))
      - (coalesce(revenue_30d, 0) * (
          coalesce(tax_rate, 0)
          + coalesce(marketplace_fee_rate, 0)
          + coalesce(payment_fee_rate, 0)
        ))
      - (coalesce(units_30d, 0) * (
          coalesce(freight_subsidy_per_unit, 0)
          + coalesce(packaging_cost_per_unit, 0)
        ))
    ) / nullif(revenue_30d, 0) < minimum_margin_rate then 'critico'
    when (
      coalesce(revenue_30d, 0)
      - (unit_cost * coalesce(units_30d, 0))
      - (coalesce(revenue_30d, 0) * (
          coalesce(tax_rate, 0)
          + coalesce(marketplace_fee_rate, 0)
          + coalesce(payment_fee_rate, 0)
        ))
      - (coalesce(units_30d, 0) * (
          coalesce(freight_subsidy_per_unit, 0)
          + coalesce(packaging_cost_per_unit, 0)
        ))
    ) / nullif(revenue_30d, 0) < target_margin_rate then 'atencao'
    else 'saudavel'
  end as margin_signal
from current_skus;

grant select on public.oraculo_sku_margin_30d to authenticated;

-- Regrava o snapshot do mes com o custo liquido; o cron horario mantem depois.
select public.oraculo_capture_fiscal_margin_snapshots();
