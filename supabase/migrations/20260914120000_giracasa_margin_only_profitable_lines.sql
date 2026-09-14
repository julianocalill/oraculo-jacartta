-- Giracasa: margem e ROI calculados só sobre as linhas que têm lucro.
--
-- Conferência fiscal de 14/09/2026 (janela 30/07–07/09). O resumo dividia o
-- lucro pela receita de todas as linhas com custo, inclusive as de TikTok e
-- Mercado Livre, que ficam sem lucro por falta de tarifa cadastrada. Como
-- sum(profit) ignora nulos, a margem saía subestimada: exibia 3,00% e ROI
-- 6,81%; o correto é 3,54% e 8,04% sobre R$ 1.160.578,96 de receita com
-- lucro. A margem por SKU tinha o mesmo defeito para SKUs vendidos também
-- nesses canais, e o snapshot repete as duas fórmulas.
--
-- Uberlândia usa a mesma fórmula, mas lá quase toda linha com custo tem
-- lucro e o valor exibido confere (8,20% / 19,05% na mesma janela). Esta
-- migration não toca nenhuma função de Uberlândia.
--
-- As três funções foram copiadas da definição em produção de 14/09 e só as
-- expressões de margin_rate/roi (e duas somas auxiliares no resumo) mudaram.
-- revenue_with_cost e coverage_cost_revenue_pct continuam como estavam: são
-- cobertura de custo, não base de margem.

CREATE OR REPLACE FUNCTION oraculo_implementation.giracasa_oraculo_fiscal_margin_summary(p_start date, p_end date)
 RETURNS TABLE(invoices_with_item bigint, revenue_with_item numeric, invoices_with_cost bigint, revenue_with_cost numeric, total_cost numeric, total_icms numeric, total_pis_cofins numeric, total_difal numeric, total_taxes numeric, total_marketplace_fee numeric, revenue_without_fee_params numeric, total_profit numeric, margin_rate numeric, roi numeric, official_valid_invoices bigint, official_valid_revenue numeric, coverage_item_revenue_pct numeric, coverage_cost_revenue_pct numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'giracasa'
AS $function$
  with lines as (
    select * from giracasa.oraculo_fiscal_margin_lines(p_start, p_end)
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
      sum(profit) as total_profit,
    sum(revenue) filter (where profit is not null) as revenue_with_profit,
    sum(cost) filter (where profit is not null) as cost_with_profit
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
    case when a.revenue_with_profit > 0 then a.total_profit / a.revenue_with_profit else null end as margin_rate,
    case when a.cost_with_profit > 0 then a.total_profit / a.cost_with_profit else null end as roi,
    o.inv as official_valid_invoices,
    o.rev as official_valid_revenue,
    case when o.rev > 0 then round(100.0 * a.revenue_with_item / o.rev, 2) else 0 end as coverage_item_revenue_pct,
    case when o.rev > 0 then round(100.0 * a.revenue_with_cost / o.rev, 2) else 0 end as coverage_cost_revenue_pct
  from agg a cross join official o;
$function$;

CREATE OR REPLACE FUNCTION oraculo_implementation.giracasa_oraculo_fiscal_sku_margin(p_start date, p_end date, p_limit integer DEFAULT 200)
 RETURNS TABLE(sku text, units numeric, revenue numeric, cost numeric, icms numeric, pis_cofins numeric, difal numeric, taxes_total numeric, marketplace_fee numeric, profit numeric, margin_rate numeric, roi numeric, cost_missing_lines bigint, fee_missing_lines bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'giracasa'
AS $function$
  select
    sku,
    sum(quantity) as units,
    sum(revenue) as revenue,
    sum(cost) as cost,
    sum(icms) as icms,
    sum(pis_cofins) as pis_cofins,
    sum(difal) as difal,
    sum(taxes_total) as taxes_total,
    sum(marketplace_fee) as marketplace_fee,
    sum(profit) as profit,
    case when sum(revenue) filter (where profit is not null) > 0 then sum(profit) / sum(revenue) filter (where profit is not null) else null end as margin_rate,
    case when sum(cost) filter (where profit is not null) > 0 then sum(profit) / sum(cost) filter (where profit is not null) else null end as roi,
    count(*) filter (where cost_missing) as cost_missing_lines,
    count(*) filter (where fee_missing) as fee_missing_lines
  from giracasa.oraculo_fiscal_margin_lines(p_start, p_end)
  where cost is not null
  group by sku
  order by revenue desc
  limit greatest(1, coalesce(p_limit, 200));
$function$;

CREATE OR REPLACE FUNCTION oraculo_implementation.giracasa_oraculo_capture_fiscal_margin_snapshots()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'giracasa'
AS $function$
declare
  v_start date;
  v_end date;
  v_summary record;
  v_skus jsonb;
  v_channels jsonb;
  v_coverage jsonb;
  v_cost_gap jsonb;
  v_now_sp timestamp := (now() at time zone 'America/Sao_Paulo');
begin
  v_start := date_trunc('month', v_now_sp)::date;
  v_end := (date_trunc('month', v_now_sp) + interval '1 month - 1 day')::date;

  perform giracasa.refresh_oraculo_fiscal_invoice_order_links(v_start, v_end);

  create temporary table tmp_margin_lines on commit drop as
  select * from giracasa.oraculo_fiscal_margin_lines(v_start, v_end);

  -- Resumo == oraculo_fiscal_margin_summary(v_start, v_end)
  select * into v_summary
  from (
    with agg as (
      select
        sum(revenue) filter (where cost is not null) as revenue_with_cost,
        sum(cost) as total_cost,
        sum(icms) filter (where cost is not null) as total_icms,
        sum(pis_cofins) filter (where cost is not null) as total_pis_cofins,
        sum(difal) filter (where cost is not null) as total_difal,
        sum(taxes_total) filter (where cost is not null) as total_taxes,
        sum(marketplace_fee) filter (where cost is not null) as total_marketplace_fee,
        sum(revenue) filter (where cost is not null and fee_missing) as revenue_without_fee_params,
        sum(profit) as total_profit,
      sum(revenue) filter (where profit is not null) as revenue_with_profit,
      sum(cost) filter (where profit is not null) as cost_with_profit
      from tmp_margin_lines
    ),
    official as (
      select coalesce(sum(billed_revenue), 0) as rev
      from oraculo_fiscal_invoices_valid
      where issued_date between v_start and v_end
    )
    select
      a.revenue_with_cost,
      a.total_cost, a.total_icms, a.total_pis_cofins, a.total_difal, a.total_taxes,
      coalesce(a.total_marketplace_fee, 0) as total_marketplace_fee,
      coalesce(a.revenue_without_fee_params, 0) as revenue_without_fee_params,
      a.total_profit,
      case when a.revenue_with_profit > 0 then a.total_profit / a.revenue_with_profit else null end as margin_rate,
      case when a.cost_with_profit > 0 then a.total_profit / a.cost_with_profit else null end as roi,
      case when o.rev > 0 then round(100.0 * a.revenue_with_cost / o.rev, 2) else 0 end as coverage_cost_revenue_pct,
      o.rev as official_valid_revenue
    from agg a cross join official o
  ) x;

  insert into giracasa.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_margin_summary',
    'Margem fiscal · resumo (mês corrente)',
    v_start, v_end,
    jsonb_build_object(
      'revenue_with_cost', v_summary.revenue_with_cost,
      'total_cost', v_summary.total_cost,
      'total_taxes', v_summary.total_taxes,
      'total_icms', v_summary.total_icms,
      'total_pis_cofins', v_summary.total_pis_cofins,
      'total_difal', v_summary.total_difal,
      'total_marketplace_fee', v_summary.total_marketplace_fee,
      'revenue_without_fee_params', v_summary.revenue_without_fee_params,
      'total_profit', v_summary.total_profit,
      'margin_rate', v_summary.margin_rate,
      'roi', v_summary.roi,
      'coverage_cost_revenue_pct', v_summary.coverage_cost_revenue_pct,
      'official_valid_revenue', v_summary.official_valid_revenue
    )
  );

  -- Margem por SKU == oraculo_fiscal_sku_margin(v_start, v_end, 500)
  select coalesce(jsonb_agg(to_jsonb(s) order by s.revenue desc), '[]'::jsonb)
    into v_skus
  from (
    select
      sku,
      sum(quantity) as units,
      sum(revenue) as revenue,
      sum(cost) as cost,
      sum(icms) as icms,
      sum(pis_cofins) as pis_cofins,
      sum(difal) as difal,
      sum(taxes_total) as taxes_total,
      sum(marketplace_fee) as marketplace_fee,
      sum(profit) as profit,
      case when sum(revenue) filter (where profit is not null) > 0 then sum(profit) / sum(revenue) filter (where profit is not null) else null end as margin_rate,
      case when sum(cost) filter (where profit is not null) > 0 then sum(profit) / sum(cost) filter (where profit is not null) else null end as roi,
      count(*) filter (where cost_missing) as cost_missing_lines,
      count(*) filter (where fee_missing) as fee_missing_lines
    from tmp_margin_lines
    where cost is not null
    group by sku
    order by revenue desc
    limit 500
  ) s;

  insert into giracasa.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_sku_margin',
    'Margem fiscal por SKU (mês corrente)',
    v_start, v_end,
    jsonb_build_object('skus', v_skus)
  );

  -- Canal — independente de margin_lines (lê de channel_sales, já otimizada).
  select coalesce(jsonb_agg(to_jsonb(c) order by c.billed_revenue desc), '[]'::jsonb)
    into v_channels
  from giracasa.oraculo_fiscal_channel_metrics(v_start, v_end) c;

  insert into giracasa.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_channel_metrics',
    'Receita fiscal por canal (mês corrente)',
    v_start, v_end,
    jsonb_build_object('channels', v_channels)
  );

  -- Cobertura de item por NF — independente de margin_lines.
  v_coverage := giracasa.oraculo_fiscal_order_item_backfill_progress(v_start, v_end);

  insert into giracasa.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'sku_coverage',
    'Cobertura SKU (mês corrente)',
    v_start, v_end,
    coalesce(v_coverage -> 'metrics', '{}'::jsonb)
      || coalesce(v_coverage -> 'coverage', '{}'::jsonb)
      || jsonb_build_object('distinct_order_item_skus', coalesce(v_coverage -> 'distinct_order_item_skus', '0'::jsonb))
  );

  -- Custos pendentes == oraculo_fiscal_cost_gap(v_start, v_end, 30)
  select coalesce(jsonb_agg(to_jsonb(g) order by g.receita_afetada desc), '[]'::jsonb)
    into v_cost_gap
  from (
    with gap_lines as (
      select l.sku, l.produto_id, l.revenue
      from tmp_margin_lines l
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
      left join giracasa.olist_products p on p.id = g.produto_id
      left join giracasa.oraculo_product_effective_cost ec on ec.product_id = g.produto_id
      group by g.sku
    ),
    missing_components as (
      select
        k.id as kit_id,
        string_agg(distinct sp.sku, ', ' order by sp.sku) as componentes_faltando
      from giracasa.olist_products k
      cross join lateral jsonb_array_elements(coalesce(k.payload->'kit', '[]'::jsonb)) comp
      left join giracasa.olist_products sp on sp.id = (comp->'produto'->>'id')
      left join giracasa.oraculo_margin_sku_params ov
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
    limit 30
  ) g;

  insert into giracasa.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_cost_gap',
    'Custos pendentes · cobertura fiscal (mês corrente)',
    v_start, v_end,
    jsonb_build_object('gap', v_cost_gap)
  );
end;
$function$;
