-- Resolvedor unificado de custo unitário por SKU (decisão 2026-07-16:
-- ancorar no SKU do marketplace; o custo vem em cadeia de prioridade):
--   1. override manual em oraculo_margin_sku_params (qualquer source, ativo)
--   2. olist_products (preco_custo_medio > preco_custo), não-kit
--   3. oraculo_product_effective_cost (kits expandidos)
-- Usado pelas colunas de margem/custo das páginas Shopee e Mercado Livre.

create or replace view public.oraculo_sku_unit_cost as
select distinct on (sku) sku, unit_cost, cost_source
from (
  select sp.sku,
         sp.unit_cost_override as unit_cost,
         1 as prio,
         'override:' || sp.source as cost_source
    from public.oraculo_margin_sku_params sp
   where sp.active
     and sp.unit_cost_override is not null
     and sp.unit_cost_override > 0
  union all
  select p.sku,
         max(coalesce(nullif(p.preco_custo_medio, 0), nullif(p.preco_custo, 0))) as unit_cost,
         2 as prio,
         'olist_products' as cost_source
    from public.olist_products p
   where p.sku is not null
     and p.tipo is distinct from 'K'
     and coalesce(nullif(p.preco_custo_medio, 0), nullif(p.preco_custo, 0)) > 0
   group by p.sku
  union all
  select c.sku,
         c.unit_cost,
         3 as prio,
         'effective_cost' as cost_source
    from public.oraculo_product_effective_cost c
   where c.sku is not null
     and c.unit_cost > 0
) x
order by sku, prio;

grant select on public.oraculo_sku_unit_cost to authenticated, service_role;
