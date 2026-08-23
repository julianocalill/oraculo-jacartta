-- oraculo_fiscal_cost_gap (20260823120000) classificava tudo que não é kit
-- incompleto como "sem custo cadastrado" ou "custo implausível", olhando só
-- oraculo_product_effective_cost. Na prática a causa mais comum é outra: a
-- linha nem tem um produto do catálogo Olist vinculado (produto_id = '0',
-- ver comentário em 20260823121000) — não adianta cadastrar custo em
-- olist_products porque não existe registro nenhum para cadastrar; o único
-- jeito é o override direto pelo SKU. Motivo novo, mais específico, para não
-- mandar o usuário procurar um produto que não existe.
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
      bool_or(p.id is not null) as tem_produto_vinculado,
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
      when not a.tem_produto_vinculado then 'SKU sem produto vinculado no Olist'
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
  'no período, ordenados por receita afetada, com o motivo específico (sem produto vinculado no Olist, '
  'kit com componente sem custo, sem custo cadastrado, ou custo implausível). Alimenta a seção '
  '"Custos pendentes" em /parametros. Em qualquer caso, o corretivo é o mesmo formulário: um override '
  'manual em oraculo_margin_sku_params pelo SKU da linha.';
