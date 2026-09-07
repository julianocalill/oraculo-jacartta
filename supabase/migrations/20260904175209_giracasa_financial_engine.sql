begin;
set local lock_timeout='5s';
create table giracasa.oraculo_financial_product_rules (
 id uuid primary key default gen_random_uuid(),
 operation_id text not null default 'giracasa' check(operation_id='giracasa'),
 sku text not null,
 valid_from date not null default current_date,
 valid_to date check(valid_to is null or valid_to>=valid_from),
 net_unit_cost numeric check(net_unit_cost>=0),
 recoverable_unit_taxes numeric check(recoverable_unit_taxes>=0),
 imported_transfer boolean not null default false,
 pis_cofins_rate numeric not null default 9.25 check(pis_cofins_rate between 0 and 100),
 pis_cofins_credit_enabled boolean not null default true,
 rule_version text not null default 'gira-casa-v1',
 note text,
 unique(sku,valid_from)
);
alter table giracasa.oraculo_financial_product_rules enable row level security;
revoke all on giracasa.oraculo_financial_product_rules from public,anon,authenticated;
grant select on giracasa.oraculo_financial_product_rules to authenticated;
grant all on giracasa.oraculo_financial_product_rules to service_role;
create policy operation_read on giracasa.oraculo_financial_product_rules for select to authenticated
 using(oraculo_private.can_access_operation('giracasa'));
comment on table giracasa.oraculo_financial_product_rules is 'Exceções do Financeiro para Giracasa por SKU/vigência. Custo líquido explícito > créditos explícitos > transferência importada comprovada > custo bruto. Ausência de regra não implica transferência.';
comment on column giracasa.oraculo_financial_product_rules.rule_version is 'Versão declarada da regra; alterações devem criar nova vigência, preservando linhas anteriores.';
comment on column giracasa.oraculo_financial_product_rules.imported_transfer is 'Somente quando houver comprovação de entrada por transferência de importado: crédito de 4% ICMS + 11,75% PIS/COFINS.';
comment on column giracasa.oraculo_financial_product_rules.recoverable_unit_taxes is 'Créditos recuperáveis medidos por unidade; precedem inferência por transferência.';

-- Keep the existing guarded public interfaces/OIDs; only change SP implementations.
create or replace function oraculo_implementation.giracasa_oraculo_net_cost_rate(p_origin text)
returns numeric language sql immutable as $$ select 0::numeric $$;
comment on function oraculo_implementation.giracasa_oraculo_net_cost_rate(text) is 'Giracasa não usa os redutores automáticos Jacarta. A regra por SKU determina créditos comprovados.';

create or replace function giracasa.oraculo_giracasa_net_cost(p_gross numeric,p_origin text,p_sku text default null,p_date date default current_date)
returns numeric language sql stable set search_path='' as $$
 select case when not oraculo_private.can_access_operation('giracasa') then null
   when r.net_unit_cost is not null then r.net_unit_cost
   when p_gross is null then null
   when r.recoverable_unit_taxes is not null then greatest(0,p_gross-r.recoverable_unit_taxes)
   when r.imported_transfer and p_origin='importado' then greatest(0,p_gross*0.8425)
   else greatest(0,p_gross) end
 from (select 1) singleton left join lateral (
   select * from giracasa.oraculo_financial_product_rules
   where sku=p_sku and valid_from<=p_date and (valid_to is null or valid_to>=p_date)
   order by valid_from desc limit 1
 ) r on true
$$;
revoke all on function giracasa.oraculo_giracasa_net_cost(numeric,text,text,date) from public,anon;
grant execute on function giracasa.oraculo_giracasa_net_cost(numeric,text,text,date) to authenticated,service_role;
comment on function giracasa.oraculo_giracasa_net_cost(numeric,text,text,date) is 'Custo canônico Giracasa, com precedência do Financeiro e vigência. Sem evidência de crédito, conserva o custo bruto.';
set local search_path=giracasa,pg_catalog;
create or replace view giracasa.oraculo_product_effective_cost as select c.* from ( WITH product_origin AS (
         SELECT olist_products.id,
                CASE
                    WHEN (olist_products.payload ->> 'origem'::text) = '1'::text THEN 'importado'::text
                    ELSE 'nacional'::text
                END AS origin
           FROM olist_products
        ), overrides AS (
         SELECT oraculo_margin_sku_params.sku,
            oraculo_margin_sku_params.unit_cost_override
           FROM oraculo_margin_sku_params
          WHERE oraculo_margin_sku_params.source = 'olist'::text AND oraculo_margin_sku_params.active AND oraculo_margin_sku_params.unit_cost_override IS NOT NULL AND oraculo_margin_sku_params.unit_cost_override > 0::numeric
        ), kit_cost AS (
         SELECT k.id AS kit_id,
            sum(((comp.value ->> 'quantidade'::text)::numeric) * giracasa.oraculo_giracasa_net_cost(COALESCE(ovc.unit_cost_override, NULLIF(sp.preco_custo_medio, 0::numeric), sp.preco_custo, 0::numeric), po_1.origin, sp.sku)) AS unit_cost,
            sum(((comp.value ->> 'quantidade'::text)::numeric) * COALESCE(ovc.unit_cost_override, NULLIF(sp.preco_custo_medio, 0::numeric), sp.preco_custo, 0::numeric)) AS unit_cost_gross,
            bool_and(COALESCE(ovc.unit_cost_override, NULLIF(sp.preco_custo_medio, 0::numeric), sp.preco_custo, 0::numeric) > 0::numeric) AS all_costed
           FROM olist_products k
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(k.payload -> 'kit'::text, '[]'::jsonb)) comp(value)
             LEFT JOIN olist_products sp ON sp.id = ((comp.value -> 'produto'::text) ->> 'id'::text)
             LEFT JOIN product_origin po_1 ON po_1.id = sp.id
             LEFT JOIN overrides ovc ON ovc.sku = sp.sku
          WHERE k.tipo = 'K'::text
          GROUP BY k.id
        )
 SELECT p.id AS product_id,
    p.sku,
    p.tipo,
        CASE
            WHEN ov.unit_cost_override IS NOT NULL THEN giracasa.oraculo_giracasa_net_cost(ov.unit_cost_override, po.origin, p.sku)
            WHEN p.tipo = 'K'::text THEN kc.unit_cost
            ELSE giracasa.oraculo_giracasa_net_cost(COALESCE(NULLIF(p.preco_custo_medio, 0::numeric), p.preco_custo, 0::numeric), po.origin, p.sku)
        END AS unit_cost,
        CASE
            WHEN ov.unit_cost_override IS NOT NULL THEN true
            WHEN p.tipo = 'K'::text THEN COALESCE(kc.all_costed, false)
            ELSE true
        END AS cost_complete,
        CASE
            WHEN ov.unit_cost_override IS NOT NULL THEN 'override:olist'::text
            WHEN p.tipo = 'K'::text THEN 'kit_components'::text
            ELSE 'product'::text
        END AS cost_source,
        CASE
            WHEN ov.unit_cost_override IS NOT NULL THEN ov.unit_cost_override
            WHEN p.tipo = 'K'::text THEN kc.unit_cost_gross
            ELSE COALESCE(NULLIF(p.preco_custo_medio, 0::numeric), p.preco_custo, 0::numeric)
        END AS unit_cost_gross
   FROM olist_products p
     LEFT JOIN overrides ov ON ov.sku = p.sku
     LEFT JOIN kit_cost kc ON kc.kit_id = p.id
     LEFT JOIN product_origin po ON po.id = p.id) c where oraculo_private.can_access_operation('giracasa');
set local search_path=public,pg_catalog;
create or replace view giracasa.oraculo_sku_unit_cost as
select distinct on (sku) sku,unit_cost,cost_source,unit_cost_gross from (
 select p.sku,giracasa.oraculo_giracasa_net_cost(p.unit_cost_override,'nacional',p.sku) unit_cost,
  'override:'||p.source cost_source,p.unit_cost_override unit_cost_gross,1 priority
 from giracasa.oraculo_margin_sku_params p
 where p.active and p.unit_cost_override>0
 union all
 select c.sku,c.unit_cost,c.cost_source,c.unit_cost_gross,
  case when c.tipo='K' then 3 else 2 end
 from giracasa.oraculo_product_effective_cost c where c.sku is not null and c.unit_cost>0
) resolved where oraculo_private.can_access_operation('giracasa') order by sku,priority;
comment on view giracasa.oraculo_sku_unit_cost is 'Livro canônico Giracasa: override > produto ERP > kit por componente. Custos próprios e créditos do perfil Gira Casa, sem redutores Jacarta.';
comment on view giracasa.oraculo_product_effective_cost is 'Custo efetivo Giracasa por produto e componentes de kit; regras por SKU e créditos comprovados. Origem ERP preservada.';
CREATE OR REPLACE FUNCTION oraculo_implementation.giracasa_oraculo_fiscal_margin_lines(p_start date, p_end date)
 RETURNS TABLE(invoice_id text, uf text, channel_label text, marketplace_key text, sku text, produto_id text, origin text, quantity numeric, revenue numeric, cost numeric, cost_missing boolean, icms numeric, pis_cofins numeric, difal numeric, taxes_total numeric, marketplace_fee numeric, fee_missing boolean, profit numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'giracasa'
AS $function$
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
      greatest(0,b.revenue * coalesce(fr.pis_cofins_rate,9.25) / 100 - case when coalesce(fr.pis_cofins_credit_enabled,true) then coalesce(b.cost,0) * coalesce(fr.pis_cofins_rate,9.25) / 100 else 0 end) as pis_cofins,
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
$function$
;
comment on function oraculo_implementation.giracasa_oraculo_fiscal_margin_lines(date,date) is 'Motor Giracasa v1: receita da NF válida rateada, matriz Gira Casa com origem SP, PIS/COFINS líquido de crédito sobre custo conforme Financeiro, DIFAL somente interestadual. Pendências não produzem lucro.';
alter table giracasa.oraculo_fiscal_snapshots add column financial_rule_version text not null default 'gira-casa-v1';
comment on column giracasa.oraculo_fiscal_snapshots.financial_rule_version is 'Versão do motor aplicada ao snapshot; operação também gravada em operation_id.';
-- Matviews vazias precisam ser populadas para consultas não falharem antes da ingestão.
do $$ declare r record; begin
 for r in select matviewname from pg_matviews where schemaname='giracasa' loop
  execute format('refresh materialized view giracasa.%I',r.matviewname);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
