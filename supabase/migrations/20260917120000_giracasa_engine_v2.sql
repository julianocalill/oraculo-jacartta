-- Giracasa: motor financeiro gira-casa-v2.
--
-- Decisões do contador (Eduardo Faleiros) repassadas em 15 e 17/09/2026:
--   * custo da Giracasa = custo − ICMS da compra − PIS/COFINS, os dois créditos
--     sobre o custo cheio: custo × (1 − ICMS da compra − 9,25%);
--   * ICMS de saída pela matriz interestadual (sem mudança);
--   * PIS/COFINS 9,25% sobre a NF de venda, débito cheio (o crédito foi para o custo);
--   * DIFAL pela diferença de alíquotas, com as alíquotas internas da tabela dele.
--
-- O ICMS da compra é medido nas notas de entrada da própria Giracasa (carga de
-- 16/09 via GET /notas?tipo=E): alíquota = valorIcms ÷ baseIcms da última compra
-- de cada produto, só compras para revenda (CFOP x101, x102, x401, x403). Kit
-- soma o custo líquido de cada componente. Produto que nunca apareceu numa compra
-- usa 12% (nacional) ou 4% (importado), as alíquotas medidas por origem.
--
-- A NF 000001 da Jacartta (24/07/2026) saiu com ICMS zero por erro pontual e
-- entra como 4% por exceção registrada, não por regra de ignorar ICMS zero.
--
-- A transferência importada com fator 0,8425 deixa de existir: foi substituída
-- pelo ICMS medido. Custo líquido explícito e créditos medidos por SKU
-- (oraculo_financial_product_rules) continuam com precedência.
--
-- Nenhum objeto de Uberlândia é alterado.

-- 1. Exceções de ICMS por nota de compra -------------------------------------
create table if not exists giracasa.oraculo_purchase_icms_overrides (
  invoice_id text primary key,
  icms_rate numeric not null check (icms_rate >= 0 and icms_rate < 1),
  reason text not null,
  decided_by text,
  decided_at date not null default current_date,
  operation_id text not null default 'giracasa' check (operation_id = 'giracasa')
);

alter table giracasa.oraculo_purchase_icms_overrides enable row level security;

drop policy if exists operation_read on giracasa.oraculo_purchase_icms_overrides;
create policy operation_read on giracasa.oraculo_purchase_icms_overrides
  for select to authenticated
  using (oraculo_private.can_access_operation('giracasa'));

grant select on giracasa.oraculo_purchase_icms_overrides to authenticated;
grant all on giracasa.oraculo_purchase_icms_overrides to service_role;

insert into giracasa.oraculo_purchase_icms_overrides (invoice_id, icms_rate, reason, decided_by, decided_at)
values ('368298589', 0.04,
        'NF 000001 da Jacartta emitida com ICMS zero por erro pontual; as demais compras do fornecedor com CFOP 2102 destacam 4%.',
        'Juliano Calil', '2026-09-17')
on conflict (invoice_id) do nothing;

-- 2. ICMS da última compra por produto ---------------------------------------
create or replace view giracasa.oraculo_product_purchase_icms as
with compras as (
  select
    i.id as invoice_id,
    i.invoice_number,
    i.emission_date,
    coalesce(
      o.icms_rate,
      case when (i.raw_json->>'baseIcms')::numeric > 0
           then (i.raw_json->>'valorIcms')::numeric / (i.raw_json->>'baseIcms')::numeric
           else 0 end
    ) as icms_rate,
    (o.invoice_id is not null) as rate_corrected
  from giracasa.olist_invoices i
  left join giracasa.oraculo_purchase_icms_overrides o on o.invoice_id = i.id
  where i.fiscal_invoice_type = 'E'
    and coalesce(i.fiscal_origin_type, '') <> 'devolucao'
    and coalesce(i.status, '') <> '3'
),
itens as (
  select
    coalesce(nullif(ii.raw_json->>'idProduto', ''), ii.product_id) as product_id,
    c.invoice_id, c.invoice_number, c.emission_date, c.icms_rate, c.rate_corrected,
    row_number() over (
      partition by coalesce(nullif(ii.raw_json->>'idProduto', ''), ii.product_id)
      order by c.emission_date desc, c.invoice_id desc
    ) as rn
  from compras c
  join giracasa.olist_invoice_items ii on ii.invoice_id = c.invoice_id
  where substr(ii.raw_json->>'cfop', 2, 3) in ('101', '102', '401', '403')
    and coalesce(nullif(ii.raw_json->>'idProduto', ''), ii.product_id) not in ('', '0')
)
select product_id, icms_rate, invoice_id, invoice_number,
       emission_date::date as purchase_date, rate_corrected
from itens
where rn = 1
  and (select oraculo_private.can_access_operation('giracasa'));

grant select on giracasa.oraculo_product_purchase_icms to authenticated, service_role;

-- 3. Custo líquido v2 ---------------------------------------------------------
create or replace function giracasa.oraculo_giracasa_net_cost_v2(
  p_gross numeric, p_icms_rate numeric, p_sku text default null, p_date date default current_date
)
returns numeric
language sql
stable
set search_path to ''
as $$
  select case
    when not oraculo_private.can_access_operation('giracasa') then null
    when r.net_unit_cost is not null then r.net_unit_cost
    when p_gross is null then null
    when r.recoverable_unit_taxes is not null then greatest(0, p_gross - r.recoverable_unit_taxes)
    else greatest(0, p_gross * (1 - coalesce(p_icms_rate, 0) - 0.0925))
  end
  from (select 1) singleton
  left join lateral (
    select * from giracasa.oraculo_financial_product_rules
    where sku = p_sku and valid_from <= p_date and (valid_to is null or valid_to >= p_date)
    order by valid_from desc limit 1
  ) r on true
$$;

comment on function giracasa.oraculo_giracasa_net_cost_v2(numeric, numeric, text, date) is
  'gira-casa-v2: custo x (1 - ICMS da compra - 9,25%), salvo custo liquido ou creditos explicitos por SKU.';

-- Caminhos que só conhecem a origem (custo manual, margem operacional por SKU)
-- usam a alíquota de compra padrão da origem, para não divergir do motor.
create or replace function giracasa.oraculo_giracasa_net_cost(
  p_gross numeric, p_origin text, p_sku text default null, p_date date default current_date
)
returns numeric
language sql
stable
set search_path to ''
as $$
  select giracasa.oraculo_giracasa_net_cost_v2(
    p_gross,
    case when p_origin = 'importado' then 0.04 else 0.12 end,
    p_sku,
    p_date
  )
$$;

create or replace function oraculo_implementation.giracasa_oraculo_net_cost_rate(p_origin text)
returns numeric
language sql
immutable parallel safe
set search_path to 'giracasa'
as $$
  select case when lower(coalesce(p_origin, '')) like 'import%' then 0.04 + 0.0925 else 0.12 + 0.0925 end;
$$;

-- 4. Custo efetivo por produto -----------------------------------------------
create or replace view giracasa.oraculo_product_effective_cost as
select product_id, sku, tipo, unit_cost, cost_complete, cost_source, unit_cost_gross,
       purchase_icms_rate, purchase_icms_source
from (
  with product_origin as (
    select id,
           case when (payload->>'origem') = '1' then 'importado' else 'nacional' end as origin
    from giracasa.olist_products
  ),
  overrides as (
    select sku, unit_cost_override
    from giracasa.oraculo_margin_sku_params
    where source = 'olist' and active and unit_cost_override is not null and unit_cost_override > 0
  ),
  product_rate as (
    select p.id as product_id,
           coalesce(pp.icms_rate, case when po.origin = 'importado' then 0.04 else 0.12 end) as icms_rate,
           case when pp.product_id is not null then 'nf_compra' else 'origem' end as rate_source
    from giracasa.olist_products p
    left join product_origin po on po.id = p.id
    left join giracasa.oraculo_product_purchase_icms pp on pp.product_id = p.id
  ),
  kit_cost as (
    select
      k.id as kit_id,
      sum(((comp.value->>'quantidade')::numeric)
          * giracasa.oraculo_giracasa_net_cost_v2(
              coalesce(ovc.unit_cost_override, nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0),
              pr.icms_rate, sp.sku)) as unit_cost,
      sum(((comp.value->>'quantidade')::numeric)
          * coalesce(ovc.unit_cost_override, nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0)) as unit_cost_gross,
      bool_and(coalesce(ovc.unit_cost_override, nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0) > 0) as all_costed,
      sum(((comp.value->>'quantidade')::numeric)
          * coalesce(ovc.unit_cost_override, nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0) * pr.icms_rate)
        / nullif(sum(((comp.value->>'quantidade')::numeric)
          * coalesce(ovc.unit_cost_override, nullif(sp.preco_custo_medio, 0), sp.preco_custo, 0)), 0) as icms_rate,
      case when bool_and(pr.rate_source = 'nf_compra') then 'nf_compra'
           when bool_or(pr.rate_source = 'nf_compra') then 'nf_compra_parcial'
           else 'origem' end as rate_source
    from giracasa.olist_products k
    cross join lateral jsonb_array_elements(coalesce(k.payload->'kit', '[]'::jsonb)) comp(value)
    left join giracasa.olist_products sp on sp.id = (comp.value->'produto'->>'id')
    left join product_rate pr on pr.product_id = sp.id
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
        then giracasa.oraculo_giracasa_net_cost_v2(ov.unit_cost_override, pr.icms_rate, p.sku)
      when p.tipo = 'K' then kc.unit_cost
      else giracasa.oraculo_giracasa_net_cost_v2(coalesce(nullif(p.preco_custo_medio, 0), p.preco_custo, 0), pr.icms_rate, p.sku)
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
    end as unit_cost_gross,
    case when p.tipo = 'K' and ov.unit_cost_override is null then kc.icms_rate else pr.icms_rate end as purchase_icms_rate,
    case when p.tipo = 'K' and ov.unit_cost_override is null then kc.rate_source else pr.rate_source end as purchase_icms_source
  from giracasa.olist_products p
  left join overrides ov on ov.sku = p.sku
  left join kit_cost kc on kc.kit_id = p.id
  left join product_rate pr on pr.product_id = p.id
) c
where (select oraculo_private.can_access_operation('giracasa'));

-- 5. Linhas de margem: PIS/COFINS cheio e DIFAL pela tabela do contador --------
CREATE OR REPLACE FUNCTION oraculo_implementation.giracasa_oraculo_fiscal_margin_lines(p_start date, p_end date)
 RETURNS TABLE(invoice_id text, uf text, channel_label text, marketplace_key text, sku text, produto_id text, origin text, quantity numeric, revenue numeric, cost numeric, cost_missing boolean, icms numeric, pis_cofins numeric, difal numeric, taxes_total numeric, marketplace_fee numeric, fee_missing boolean, profit numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'giracasa'
AS $function$
  -- gira-casa-v2: alíquotas internas da tabela do contador (17/09/2026).
  with internal_icms(uf, rate) as (
    values ('AC',17),('AL',18),('AP',18),('AM',18),('BA',18),('CE',18),('DF',18),
           ('ES',17),('GO',17),('MA',18),('MT',17),('MS',17),('MG',18),('PA',17),
           ('PB',18),('PR',18),('PE',18),('PI',18),('RJ',20),('RN',18),('RS',17),
           ('RO',17.5),('RR',17),('SC',17),('SP',18),('SE',18),('TO',18)
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
    from giracasa.oraculo_fiscal_invoices_valid
    where issued_date between p_start and p_end
  ),
  order_item_invoices as materialized (
    select distinct l.invoice_id
    from giracasa.oraculo_fiscal_invoice_order_links l
    join valid_invoices inv on inv.id = l.invoice_id
    join giracasa.olist_order_items oi on oi.order_id = l.order_id
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
    join giracasa.oraculo_fiscal_invoice_order_links l on l.invoice_id = inv.id
    join giracasa.olist_order_items oi on oi.order_id = l.order_id

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
    join giracasa.olist_invoice_items ii on ii.invoice_id = inv.id
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
      case
        when ov.unit_cost_override is not null then
          giracasa.oraculo_net_cost(
            ov.unit_cost_override,
            case when (p.payload->>'origem') = '1' then 'importado' else 'nacional' end
          )
        else coalesce(ec.unit_cost, 0)
      end::numeric as raw_unit_cost,
      case
        when ov.unit_cost_override is not null then true
        else coalesce(ec.cost_complete, false)
      end as cost_complete
    from source_lines s
    left join giracasa.olist_products p on p.id = s.produto_id
    left join giracasa.oraculo_product_effective_cost ec on ec.product_id = s.produto_id
    left join giracasa.oraculo_margin_sku_params ov
      on ov.sku = s.sku and ov.source = 'olist' and ov.active and ov.unit_cost_override > 0
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
        case when b.uf = 'SP' then 18 when b.origin = 'importado' then 4 when b.uf in ('MG','PR','RJ','RS','SC') then 12 else 7 end
      ) / 100.0 as icms,
      -- gira-casa-v2: o crédito de PIS/COFINS já está no custo líquido; na venda
      -- fica o débito cheio, sem abater crédito de novo.
      b.revenue * coalesce(fr.pis_cofins_rate,9.25) / 100 as pis_cofins,
      -- Diferença simples de alíquotas, sem gross-up (ADR-004, 14/08/2026).
      case when b.uf = 'SP' then 0 else
        b.revenue * greatest(0,
          coalesce(tp.icms_rate, ii.rate, 0)
          - coalesce(tp.interstate_icms_rate,
              case when b.origin = 'importado' then 4
                   when b.uf in ('MG','PR','RJ','RS','SC') then 12
                   else 7 end)
        ) / 100.0
      end as difal,
      fee.marketplace_key,
      not coalesce(fee.fee_configured, false) as fee_missing,
      case when fee.fee_configured then
        b.revenue * coalesce(fee.rate, 0) / 100.0
        + case
            when b.item_source = 'invoice_item' and b.invoice_total > 0
              then coalesce(fee.fixed, 0) * b.revenue / b.invoice_total
            when b.item_source = 'invoice_item'
              then 0
            else coalesce(fee.fixed, 0) * b.quantity
          end
      else 0 end as marketplace_fee
    from base b
    left join lateral (select r.* from giracasa.oraculo_financial_product_rules r where r.sku=b.sku and r.valid_from<=b.issued_date and (r.valid_to is null or r.valid_to>=b.issued_date) order by r.valid_from desc limit 1) fr on true
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
    case when cost is null or fee_missing or uf not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then null
         else revenue - cost - icms - pis_cofins - difal - marketplace_fee end as profit
  from calc;
$function$;

-- 6. Versão padrão das regras e dos snapshots ---------------------------------
alter table giracasa.oraculo_financial_product_rules alter column rule_version set default 'gira-casa-v2';
alter table giracasa.oraculo_fiscal_snapshots alter column financial_rule_version set default 'gira-casa-v2';
