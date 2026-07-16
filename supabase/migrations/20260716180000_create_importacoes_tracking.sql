-- Aba Importações: rastreamento de importações (portado do MVP local
-- rastreamento-importacoes). Faturas/itens vêm do follow-up (planilha a
-- partir da linha 419) ou de cadastro manual; navios e posições AIS vêm
-- do registro local sincronizado com VesselAPI/AISStream.

create table if not exists public.importacao_faturas (
  invoice_number text primary key,
  process_name text,
  production_start date,
  production_end date,
  bl text,
  container_number text,
  vessel_name text,
  destination text,
  port_arrival date,
  transit_agent text,
  packing_list_yuan numeric,
  packing_list_usd numeric,
  packing_list_brl numeric,
  taxes_brl numeric,
  total_cash_brl numeric,
  transfer_invoice text,
  origin text not null default 'manual', -- 'planilha' | 'manual'
  source_sheet text,
  source_first_row integer,
  source_last_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists importacao_faturas_vessel_idx
  on public.importacao_faturas (vessel_name);

create table if not exists public.importacao_itens (
  id bigint generated always as identity primary key,
  invoice_number text not null
    references public.importacao_faturas (invoice_number) on delete cascade,
  description text not null,
  quantity numeric,
  unit_cost_yuan numeric,
  unit_cost_with_tax_brl numeric,
  cartons numeric,
  quantity_per_carton numeric,
  cbm numeric,
  cbm_total numeric,
  source_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists importacao_itens_invoice_idx
  on public.importacao_itens (invoice_number);

-- Registro de identidade dos navios (nome da planilha via aliases -> IMO/MMSI)
create table if not exists public.importacao_navios (
  name text primary key,
  aliases text[] not null default '{}',
  imo text,
  mmsi text,
  updated_at timestamptz not null default now()
);

create index if not exists importacao_navios_mmsi_idx
  on public.importacao_navios (mmsi);

-- Última posição AIS conhecida por MMSI
create table if not exists public.importacao_posicoes (
  mmsi text primary key,
  vessel_name text,
  latitude double precision not null,
  longitude double precision not null,
  speed_knots numeric,
  course_degrees numeric,
  heading_degrees numeric,
  provider text,
  observed_at timestamptz,
  received_at timestamptz,
  updated_at timestamptz not null default now()
);

-- RLS no padrão do projeto: escrita service_role, leitura authenticated
alter table public.importacao_faturas enable row level security;
alter table public.importacao_itens enable row level security;
alter table public.importacao_navios enable row level security;
alter table public.importacao_posicoes enable row level security;

revoke all on table public.importacao_faturas from public, anon, authenticated;
revoke all on table public.importacao_itens from public, anon, authenticated;
revoke all on table public.importacao_navios from public, anon, authenticated;
revoke all on table public.importacao_posicoes from public, anon, authenticated;

grant all on table public.importacao_faturas to service_role;
grant all on table public.importacao_itens to service_role;
grant all on table public.importacao_navios to service_role;
grant all on table public.importacao_posicoes to service_role;

grant select on table public.importacao_faturas to authenticated;
grant select on table public.importacao_itens to authenticated;
grant select on table public.importacao_navios to authenticated;
grant select on table public.importacao_posicoes to authenticated;

create policy importacao_faturas_authenticated_read
  on public.importacao_faturas for select to authenticated using (true);
create policy importacao_itens_authenticated_read
  on public.importacao_itens for select to authenticated using (true);
create policy importacao_navios_authenticated_read
  on public.importacao_navios for select to authenticated using (true);
create policy importacao_posicoes_authenticated_read
  on public.importacao_posicoes for select to authenticated using (true);
