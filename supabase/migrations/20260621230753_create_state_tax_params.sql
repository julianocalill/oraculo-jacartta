create table if not exists public.oraculo_state_tax_params (
  uf text not null,
  operation_type text not null default 'venda_consumidor',
  icms_rate numeric not null default 0,
  fcp_rate numeric not null default 0,
  difal_rate numeric not null default 0,
  effective_tax_rate numeric not null default 0,
  applies_to_source text not null default '*',
  params_configured boolean not null default false,
  valid_from date not null default current_date,
  valid_to date,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (uf, operation_type, applies_to_source, valid_from),
  constraint oraculo_state_tax_params_uf_check check (uf ~ '^[A-Z]{2}$'),
  constraint oraculo_state_tax_params_rates_check check (
    icms_rate >= 0
    and fcp_rate >= 0
    and difal_rate >= 0
    and effective_tax_rate >= 0
  ),
  constraint oraculo_state_tax_params_validity_check check (
    valid_to is null or valid_to >= valid_from
  )
);

alter table public.oraculo_state_tax_params enable row level security;

insert into public.oraculo_state_tax_params (
  uf,
  operation_type,
  applies_to_source,
  notes
)
select
  uf,
  'venda_consumidor',
  '*',
  'Pendente de validacao fiscal. Preencher aliquotas com apoio do contador antes de usar em margem/ROI.'
from unnest(array[
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
]) as uf
on conflict (uf, operation_type, applies_to_source, valid_from) do nothing;
