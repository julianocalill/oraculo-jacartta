-- Giracasa: margem por SKU passa a enxergar o custo dos kits.
--
-- A aba SKUs marcava como "sem custo" todo kit, porque o CTE de custo excluia
-- produtos tipo 'K' e lia preco_custo direto do produto. Efeito medido em
-- 23/09/2026: 68 kits com venda nos ultimos 30 dias, R$ 493,7 mil de receita,
-- sem margem na tela -- sendo que 66 deles ja tinham custo calculado pelo motor
-- fiscal, somado pelos componentes.
--
-- A correcao usa giracasa.oraculo_product_effective_cost, a mesma fonte do
-- motor fiscal (custo liquido de ICMS da compra e PIS/COFINS, kit pelos
-- componentes), eliminando a divergencia entre a margem fiscal e a operacional.
--
-- Uberlandia tem o mesmo comportamento na view dela e NAO e alterada aqui, por
-- decisao do usuario em 23/09/2026.

create or replace view giracasa.oraculo_sku_margin_30d as
 SELECT source,
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
    product_cost_30d,
    fee_cost_30d,
    operational_cost_30d,
    margin_amount_30d,
    margin_rate_30d,
    roi_30d,
    margin_signal
   FROM ( WITH sku_origin AS (
                 SELECT olist_products.sku,
                        CASE
                            WHEN bool_or((olist_products.payload ->> 'origem'::text) = '1'::text) THEN 'importado'::text
                            ELSE 'nacional'::text
                        END AS origin
                   FROM giracasa.olist_products
                  WHERE olist_products.sku IS NOT NULL
                  GROUP BY olist_products.sku
                ), olist_costs AS (
                 -- gira-casa-v2 (23/09/2026): o custo vem da mesma view do motor
                 -- fiscal, que resolve kit pelos componentes. A versao anterior
                 -- excluia tipo 'K' e deixava todo kit como "sem custo".
                 SELECT 'olist'::text AS source,
                    c.sku,
                    max(c.unit_cost) AS source_unit_cost
                   FROM giracasa.oraculo_product_effective_cost c
                  WHERE c.sku IS NOT NULL AND c.cost_complete AND c.unit_cost > 0::numeric
                  GROUP BY c.sku
                ), current_skus AS (
                 SELECT c.source,
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
                    COALESCE(oraculo_implementation.giracasa_oraculo_net_cost(sp.unit_cost_override, so.origin), oc.source_unit_cost) AS unit_cost,
                    COALESCE(sp.target_margin_rate_override, cp.target_margin_rate) AS target_margin_rate,
                    COALESCE(sp.minimum_margin_rate_override, cp.minimum_margin_rate) AS minimum_margin_rate,
                    cp.tax_rate,
                    cp.marketplace_fee_rate,
                    cp.payment_fee_rate,
                    cp.freight_subsidy_per_unit,
                    cp.packaging_cost_per_unit,
                    cp.params_configured
                   FROM giracasa.oraculo_sku_current_unified c
                     LEFT JOIN olist_costs oc ON oc.source = c.source AND oc.sku = c.sku
                     LEFT JOIN sku_origin so ON so.sku = c.sku
                     LEFT JOIN giracasa.oraculo_margin_channel_params cp ON cp.source = c.source AND cp.channel_key = '*'::text
                     LEFT JOIN giracasa.oraculo_margin_sku_params sp ON sp.source = c.source AND sp.sku = c.sku AND sp.active
                )
         SELECT current_skus.source,
            current_skus.sku,
            current_skus.product_name,
            current_skus.status_label,
            current_skus.units_30d,
            current_skus.revenue_30d,
            current_skus.units_prev_30d,
            current_skus.revenue_prev_30d,
            current_skus.revenue_change_pct,
            current_skus.available_stock,
            current_skus.stock_balance,
            current_skus.days_until_stockout,
            current_skus.last_sale_at,
            current_skus.unit_cost,
            current_skus.target_margin_rate,
            current_skus.minimum_margin_rate,
            current_skus.tax_rate,
            current_skus.marketplace_fee_rate,
            current_skus.payment_fee_rate,
            current_skus.freight_subsidy_per_unit,
            current_skus.packaging_cost_per_unit,
            current_skus.params_configured,
                CASE
                    WHEN current_skus.unit_cost IS NULL OR current_skus.unit_cost <= 0::numeric THEN NULL::numeric
                    ELSE current_skus.unit_cost * COALESCE(current_skus.units_30d, 0::numeric)
                END AS product_cost_30d,
            COALESCE(current_skus.revenue_30d, 0::numeric) * (COALESCE(current_skus.tax_rate, 0::numeric) + COALESCE(current_skus.marketplace_fee_rate, 0::numeric) + COALESCE(current_skus.payment_fee_rate, 0::numeric)) AS fee_cost_30d,
            COALESCE(current_skus.units_30d, 0::numeric) * (COALESCE(current_skus.freight_subsidy_per_unit, 0::numeric) + COALESCE(current_skus.packaging_cost_per_unit, 0::numeric)) AS operational_cost_30d,
                CASE
                    WHEN current_skus.unit_cost IS NULL OR current_skus.unit_cost <= 0::numeric THEN NULL::numeric
                    ELSE COALESCE(current_skus.revenue_30d, 0::numeric) - current_skus.unit_cost * COALESCE(current_skus.units_30d, 0::numeric) - COALESCE(current_skus.revenue_30d, 0::numeric) * (COALESCE(current_skus.tax_rate, 0::numeric) + COALESCE(current_skus.marketplace_fee_rate, 0::numeric) + COALESCE(current_skus.payment_fee_rate, 0::numeric)) - COALESCE(current_skus.units_30d, 0::numeric) * (COALESCE(current_skus.freight_subsidy_per_unit, 0::numeric) + COALESCE(current_skus.packaging_cost_per_unit, 0::numeric))
                END AS margin_amount_30d,
                CASE
                    WHEN COALESCE(current_skus.revenue_30d, 0::numeric) <= 0::numeric THEN NULL::numeric
                    WHEN current_skus.unit_cost IS NULL OR current_skus.unit_cost <= 0::numeric THEN NULL::numeric
                    ELSE (COALESCE(current_skus.revenue_30d, 0::numeric) - current_skus.unit_cost * COALESCE(current_skus.units_30d, 0::numeric) - COALESCE(current_skus.revenue_30d, 0::numeric) * (COALESCE(current_skus.tax_rate, 0::numeric) + COALESCE(current_skus.marketplace_fee_rate, 0::numeric) + COALESCE(current_skus.payment_fee_rate, 0::numeric)) - COALESCE(current_skus.units_30d, 0::numeric) * (COALESCE(current_skus.freight_subsidy_per_unit, 0::numeric) + COALESCE(current_skus.packaging_cost_per_unit, 0::numeric))) / NULLIF(current_skus.revenue_30d, 0::numeric)
                END AS margin_rate_30d,
                CASE
                    WHEN current_skus.unit_cost IS NULL OR current_skus.unit_cost <= 0::numeric OR COALESCE(current_skus.units_30d, 0::numeric) <= 0::numeric THEN NULL::numeric
                    ELSE (COALESCE(current_skus.revenue_30d, 0::numeric) - current_skus.unit_cost * COALESCE(current_skus.units_30d, 0::numeric) - COALESCE(current_skus.revenue_30d, 0::numeric) * (COALESCE(current_skus.tax_rate, 0::numeric) + COALESCE(current_skus.marketplace_fee_rate, 0::numeric) + COALESCE(current_skus.payment_fee_rate, 0::numeric)) - COALESCE(current_skus.units_30d, 0::numeric) * (COALESCE(current_skus.freight_subsidy_per_unit, 0::numeric) + COALESCE(current_skus.packaging_cost_per_unit, 0::numeric))) / NULLIF(current_skus.unit_cost * COALESCE(current_skus.units_30d, 0::numeric), 0::numeric)
                END AS roi_30d,
                CASE
                    WHEN COALESCE(current_skus.revenue_30d, 0::numeric) <= 0::numeric THEN 'sem_venda'::text
                    WHEN NOT COALESCE(current_skus.params_configured, false) THEN 'configurar_parametros'::text
                    WHEN current_skus.unit_cost IS NULL OR current_skus.unit_cost <= 0::numeric THEN 'sem_custo'::text
                    WHEN ((COALESCE(current_skus.revenue_30d, 0::numeric) - current_skus.unit_cost * COALESCE(current_skus.units_30d, 0::numeric) - COALESCE(current_skus.revenue_30d, 0::numeric) * (COALESCE(current_skus.tax_rate, 0::numeric) + COALESCE(current_skus.marketplace_fee_rate, 0::numeric) + COALESCE(current_skus.payment_fee_rate, 0::numeric)) - COALESCE(current_skus.units_30d, 0::numeric) * (COALESCE(current_skus.freight_subsidy_per_unit, 0::numeric) + COALESCE(current_skus.packaging_cost_per_unit, 0::numeric))) / NULLIF(current_skus.revenue_30d, 0::numeric)) < current_skus.minimum_margin_rate THEN 'critico'::text
                    WHEN ((COALESCE(current_skus.revenue_30d, 0::numeric) - current_skus.unit_cost * COALESCE(current_skus.units_30d, 0::numeric) - COALESCE(current_skus.revenue_30d, 0::numeric) * (COALESCE(current_skus.tax_rate, 0::numeric) + COALESCE(current_skus.marketplace_fee_rate, 0::numeric) + COALESCE(current_skus.payment_fee_rate, 0::numeric)) - COALESCE(current_skus.units_30d, 0::numeric) * (COALESCE(current_skus.freight_subsidy_per_unit, 0::numeric) + COALESCE(current_skus.packaging_cost_per_unit, 0::numeric))) / NULLIF(current_skus.revenue_30d, 0::numeric)) < current_skus.target_margin_rate THEN 'atencao'::text
                    ELSE 'saudavel'::text
                END AS margin_signal
           FROM current_skus) scoped
  WHERE ( SELECT oraculo_private.can_access_operation('giracasa'::text) AS can_access_operation);
