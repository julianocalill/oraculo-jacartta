create table if not exists public.product_cost_snapshots (
  id text primary key,
  product_id text,
  sku text,
  description text,
  source text not null default 'olist',
  source_invoice_id text,
  source_invoice_number text,
  source_access_key text,
  source_emission_date date,
  input_document_type text,
  fiscal_origin text,
  cfop text,
  ncm text,
  quantity numeric not null default 0,
  gross_unit_cost numeric not null default 0,
  gross_total_cost numeric not null default 0,
  recoverable_icms_unit numeric not null default 0,
  recoverable_pis_cofins_unit numeric not null default 0,
  recoverable_taxes_unit numeric not null default 0,
  recoverable_taxes_total numeric not null default 0,
  net_unit_cost numeric not null default 0,
  net_total_cost numeric not null default 0,
  cost_rule text,
  validation_status text not null default 'pending',
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_cost_snapshots_product_idx
  on public.product_cost_snapshots (product_id, source_emission_date desc);

create index if not exists product_cost_snapshots_sku_idx
  on public.product_cost_snapshots (sku, source_emission_date desc);

create index if not exists product_cost_snapshots_invoice_idx
  on public.product_cost_snapshots (source_invoice_id);

create index if not exists product_cost_snapshots_rule_idx
  on public.product_cost_snapshots (cost_rule, validation_status);

alter table public.product_cost_snapshots enable row level security;

revoke all on table public.product_cost_snapshots from anon, authenticated;
grant all on table public.product_cost_snapshots to service_role;
