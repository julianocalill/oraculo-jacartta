create table if not exists public.oraculo_margin_channel_params (
  source text not null,
  channel_key text not null default '*',
  display_name text,
  tax_rate numeric not null default 0,
  marketplace_fee_rate numeric not null default 0,
  payment_fee_rate numeric not null default 0,
  freight_subsidy_per_unit numeric not null default 0,
  packaging_cost_per_unit numeric not null default 0,
  target_margin_rate numeric not null default 0.25,
  minimum_margin_rate numeric not null default 0.12,
  params_configured boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (source, channel_key),
  constraint oraculo_margin_channel_params_rates_check check (
    tax_rate >= 0
    and marketplace_fee_rate >= 0
    and payment_fee_rate >= 0
    and target_margin_rate >= 0
    and minimum_margin_rate >= 0
  )
);

alter table public.oraculo_margin_channel_params enable row level security;

create table if not exists public.oraculo_margin_sku_params (
  source text not null,
  sku text not null,
  unit_cost_override numeric,
  target_margin_rate_override numeric,
  minimum_margin_rate_override numeric,
  active boolean not null default true,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (source, sku),
  constraint oraculo_margin_sku_params_values_check check (
    (unit_cost_override is null or unit_cost_override >= 0)
    and (target_margin_rate_override is null or target_margin_rate_override >= 0)
    and (minimum_margin_rate_override is null or minimum_margin_rate_override >= 0)
  )
);

alter table public.oraculo_margin_sku_params enable row level security;

insert into public.oraculo_margin_channel_params (
  source,
  channel_key,
  display_name,
  notes
)
values
  ('olist', '*', 'Olist - padrão', 'Parametros aguardando validacao operacional. Enquanto params_configured=false, margem/ROI ficam como configuracao pendente.'),
  ('shopee', '*', 'Shopee - padrão', 'Somente leitura. Parametros aguardando validacao operacional. Enquanto params_configured=false, margem/ROI ficam como configuracao pendente.')
on conflict (source, channel_key) do nothing;

create or replace view public.oraculo_sku_margin_30d
with (security_invoker = true)
as
with olist_costs as (
  select
    'olist'::text as source,
    sku,
    max(coalesce(preco_custo_medio, preco_custo)) as source_unit_cost
  from public.olist_products
  where sku is not null
    and tipo is distinct from 'K'
  group by sku
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
    coalesce(sp.unit_cost_override, oc.source_unit_cost) as unit_cost,
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
