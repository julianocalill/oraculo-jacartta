-- O motor fiscal (oraculo_fiscal_margin_lines) resolve custo por produto_id
-- direto contra oraculo_product_effective_cost, que só olhava
-- olist_products.preco_custo/preco_custo_medio. O override manual em
-- oraculo_margin_sku_params (já usado pelo formulário de /parametros e pelo
-- cadastro em massa de /shopee/reposicao) nunca era consultado aqui — quem
-- preenchia um custo manual via essas telas via a Cobertura fiscal (card
-- "Lucro fiscal") continuar igual. Esta migration liga o override na cadeia,
-- com a mesma prioridade que já vale em oraculo_sku_unit_cost, e também
-- deixa cada componente de kit usar seu próprio override (resolve o caso
-- "kit incompleto" preenchendo só a peça que falta, sem mexer no kit).
create or replace view public.oraculo_product_effective_cost
with (security_invoker = false) as
with product_origin as (
  select
    id,
    case when (payload->>'origem') = '1' then 'importado' else 'nacional' end as origin
  from olist_products
),
overrides as (
  select sku, unit_cost_override
  from oraculo_margin_sku_params
  where source = 'olist'
    and active
    and unit_cost_override is not null
    and unit_cost_override > 0
),
kit_cost as (
  select
    k.id as kit_id,
    sum(
      (comp->>'quantidade')::numeric
      * public.oraculo_net_cost(
          coalesce(ovc.unit_cost_override, nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0),
          po.origin
        )
    ) as unit_cost,
    sum(
      (comp->>'quantidade')::numeric
      * coalesce(ovc.unit_cost_override, nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0)
    ) as unit_cost_gross,
    bool_and(coalesce(ovc.unit_cost_override, nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0) > 0) as all_costed
  from olist_products k
  cross join lateral jsonb_array_elements(coalesce(k.payload->'kit', '[]'::jsonb)) comp
  left join olist_products sp on sp.id = (comp->'produto'->>'id')
  left join product_origin po on po.id = sp.id
  left join overrides ovc on ovc.sku = sp.sku
  where k.tipo = 'K'
  group by k.id
)
select
  p.id as product_id,
  p.sku,
  p.tipo,
  case
    when ov.unit_cost_override is not null
      then public.oraculo_net_cost(ov.unit_cost_override, po.origin)
    when p.tipo = 'K' then kc.unit_cost
    else public.oraculo_net_cost(
           coalesce(nullif(p.preco_custo_medio, 0), p.preco_custo, 0),
           po.origin
         )
  end as unit_cost,
  case
    when ov.unit_cost_override is not null then true
    when p.tipo = 'K' then coalesce(kc.all_costed, false)
    else true
  end as cost_complete,
  case
    when ov.unit_cost_override is not null then 'override:olist'
    when p.tipo = 'K' then 'kit_components'
    else 'product'
  end as cost_source,
  case
    when ov.unit_cost_override is not null then ov.unit_cost_override
    when p.tipo = 'K' then kc.unit_cost_gross
    else coalesce(nullif(p.preco_custo_medio, 0), p.preco_custo, 0)
  end as unit_cost_gross
from olist_products p
left join overrides ov on ov.sku = p.sku
left join kit_cost kc on kc.kit_id = p.id
left join product_origin po on po.id = p.id;

grant select on public.oraculo_product_effective_cost to authenticated;

comment on view public.oraculo_product_effective_cost is
  'Custo efetivo por produto Olist (líquido de crédito recuperável). Prioridade: '
  'override manual ativo em oraculo_margin_sku_params (source=olist) > custo cadastrado '
  'no Olist > para kits, soma dos componentes (cada componente também aceita override '
  'próprio). Consumida direto por oraculo_fiscal_margin_lines e, via oraculo_sku_unit_cost, '
  'por /skus, /shopee e /mercado-livre.';

-- Lista os SKUs cuja receita fica fora da Cobertura fiscal (card "Lucro
-- fiscal") por falta de custo confiável, ordenados por receita afetada —
-- é o que alimenta a nova seção "Custos pendentes" em /parametros.
create or replace function public.oraculo_fiscal_cost_gap(
  p_start date,
  p_end date,
  p_limit int default 50
)
returns table (
  sku text,
  nome text,
  tipo text,
  motivo text,
  componentes_faltando text,
  receita_afetada numeric,
  linhas bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with gap_lines as (
    select l.sku, l.produto_id, l.revenue
    from public.oraculo_fiscal_margin_lines(p_start, p_end) l
    where l.cost_missing
  ),
  agg as (
    select
      g.sku,
      max(p.nome) as nome,
      max(p.tipo) as tipo,
      max(g.produto_id) as produto_id,
      max(ec.unit_cost) as effective_unit_cost,
      bool_and(coalesce(ec.cost_complete, false)) as cost_complete,
      sum(g.revenue) as receita_afetada,
      count(*) as linhas
    from gap_lines g
    left join public.olist_products p on p.id = g.produto_id
    left join public.oraculo_product_effective_cost ec on ec.product_id = g.produto_id
    group by g.sku
  ),
  missing_components as (
    select
      k.id as kit_id,
      string_agg(distinct sp.sku, ', ' order by sp.sku) as componentes_faltando
    from public.olist_products k
    cross join lateral jsonb_array_elements(coalesce(k.payload->'kit', '[]'::jsonb)) comp
    left join public.olist_products sp on sp.id = (comp->'produto'->>'id')
    left join public.oraculo_margin_sku_params ov
      on ov.sku = sp.sku and ov.source = 'olist' and ov.active and ov.unit_cost_override > 0
    where k.tipo = 'K'
      and ov.unit_cost_override is null
      and coalesce(nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0) <= 0
    group by k.id
  )
  select
    a.sku,
    a.nome,
    a.tipo,
    case
      when a.tipo = 'K' and not a.cost_complete then 'kit com componente sem custo'
      when a.effective_unit_cost is null or a.effective_unit_cost <= 0 then 'sem custo cadastrado'
      else 'custo implausível (maior que 3x o preço de venda)'
    end as motivo,
    mc.componentes_faltando,
    a.receita_afetada,
    a.linhas
  from agg a
  left join missing_components mc on mc.kit_id = a.produto_id
  order by a.receita_afetada desc
  limit p_limit
$$;

grant execute on function public.oraculo_fiscal_cost_gap(date, date, int) to authenticated;

comment on function public.oraculo_fiscal_cost_gap(date, date, int) is
  'Lista os SKUs cuja receita fica fora da Cobertura fiscal (oraculo_fiscal_margin_lines.cost_missing) '
  'no período, ordenados por receita afetada. Para kits, aponta o(s) componente(s) ainda sem custo/override. '
  'Alimenta a seção "Custos pendentes" em /parametros.';
