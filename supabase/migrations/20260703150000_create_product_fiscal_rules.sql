create table if not exists public.product_fiscal_rules (
  id uuid primary key default gen_random_uuid(),
  sku_olist text not null,
  olist_product_id text,
  description text,
  ncm text,
  merchandise_origin text not null default 'pendente'
    check (merchandise_origin in ('nacional', 'importado', 'pendente')),
  tax_profile text not null default 'jacarta',
  pis_cofins_rule text not null default 'base_9_25',
  pis_cofins_rate numeric(8,4),
  pis_cofins_credit_eligible boolean,
  icms_rule text not null default 'matrix_by_uf_origin',
  difal_rule text not null default 'pending_validation',
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'validated', 'needs_review', 'inactive')),
  source_file text,
  source_row_number integer,
  notes text,
  valid_from date not null default current_date,
  valid_to date,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sku_olist, tax_profile, valid_from)
);

create index if not exists product_fiscal_rules_sku_idx
  on public.product_fiscal_rules (sku_olist);

create index if not exists product_fiscal_rules_olist_product_idx
  on public.product_fiscal_rules (olist_product_id);

create index if not exists product_fiscal_rules_ncm_idx
  on public.product_fiscal_rules (ncm);

create index if not exists product_fiscal_rules_status_idx
  on public.product_fiscal_rules (validation_status);

create or replace function public.set_product_fiscal_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_fiscal_rules_set_updated_at on public.product_fiscal_rules;

create trigger product_fiscal_rules_set_updated_at
before update on public.product_fiscal_rules
for each row
execute function public.set_product_fiscal_rules_updated_at();

alter table public.product_fiscal_rules enable row level security;

grant select, insert, update, delete on public.product_fiscal_rules to service_role;
