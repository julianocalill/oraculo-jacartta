-- Planejamento recorrente de envios para fulfillment (Shopee FBS, Mercado
-- Livre Full e Amazon Onsite) dentro da Agenda.
--
-- A data da coleta e o responsável são configuração operacional: a migration
-- descobre as lojas, mas NÃO inventa dias nem donos. O cron ignora linhas ainda
-- não configuradas. Depois da configuração, gera uma tarefa semanal por loja,
-- idempotente por (loja, data), com os SKUs sugeridos como sub-tarefas.
--
-- Escritas continuam service_role-only. A configuração não contém dado
-- sensível e pode ser lida por usuários autenticados; tarefas e sub-tarefas
-- continuam protegidas pela RLS de participante já existente.

alter table public.oraculo_agenda_tasks
  add column if not exists task_kind text not null default 'manual'
    check (task_kind in ('manual', 'full_replenishment')),
  add column if not exists source_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists generated_at timestamptz;

create unique index if not exists oraculo_agenda_tasks_source_due_unique
  on public.oraculo_agenda_tasks (source_key, due_day)
  where source_key is not null;

alter table public.oraculo_agenda_subtasks
  add column if not exists source_key text;

create unique index if not exists oraculo_agenda_subtasks_source_unique
  on public.oraculo_agenda_subtasks (task_id, source_key);

comment on column public.oraculo_agenda_tasks.task_kind is
  'Origem funcional da tarefa: manual ou full_replenishment (planejamento automático de coleta para fulfillment).';
comment on column public.oraculo_agenda_tasks.source_key is
  'Chave idempotente da origem automática. Em Full usa full:<canal>:<loja>; combinada com due_day impede tarefa duplicada para a mesma coleta.';
comment on column public.oraculo_agenda_tasks.metadata is
  'Metadados estruturados da automação (canal, loja, cobertura, coleta, totais e origem dos dados). Não usar para autorização.';
comment on column public.oraculo_agenda_tasks.generated_at is
  'Momento da última geração/revisão automática da tarefa; nulo em tarefas manuais.';
comment on column public.oraculo_agenda_subtasks.source_key is
  'Chave idempotente do SKU/anúncio numa tarefa automática. Preserva o estado concluído quando a sugestão é recalculada.';

create table if not exists public.oraculo_full_planning_configs (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('shopee', 'mercadolivre', 'amazon')),
  store_key text not null,
  store_name text not null,
  pickup_weekday smallint check (pickup_weekday between 0 and 6),
  coverage_days smallint not null default 20 check (coverage_days between 7 and 90),
  max_suggestions smallint not null default 15 check (max_suggestions between 1 and 100),
  assignee_user_id uuid,
  enabled boolean not null default false,
  last_generated_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, store_key)
);

create index if not exists oraculo_full_planning_configs_enabled_idx
  on public.oraculo_full_planning_configs (enabled, pickup_weekday);

alter table public.oraculo_full_planning_configs enable row level security;
revoke all on table public.oraculo_full_planning_configs from public, anon, authenticated;
grant all on table public.oraculo_full_planning_configs to service_role;
grant select on table public.oraculo_full_planning_configs to authenticated;

drop policy if exists oraculo_full_planning_configs_read on public.oraculo_full_planning_configs;
create policy oraculo_full_planning_configs_read
  on public.oraculo_full_planning_configs for select to authenticated using (true);

comment on table public.oraculo_full_planning_configs is
  'Configuração semanal do planejamento Full por loja. O cron só gera tarefas quando enabled=true, pickup_weekday e assignee_user_id estão preenchidos. A cobertura padrão e operacional é 20 dias.';
comment on column public.oraculo_full_planning_configs.channel is 'shopee (FBS) | mercadolivre (Full) | amazon (Onsite via Olist).';
comment on column public.oraculo_full_planning_configs.store_key is 'Identificador estável da loja na fonte: shop_id Shopee, seller_id ML ou amazon-onsite.';
comment on column public.oraculo_full_planning_configs.pickup_weekday is 'Dia semanal da coleta: 0=domingo, 1=segunda, ..., 6=sábado.';
comment on column public.oraculo_full_planning_configs.coverage_days is 'Cobertura desejada APÓS a coleta. A quantidade considera também os dias que faltam até a coleta.';
comment on column public.oraculo_full_planning_configs.assignee_user_id is 'Usuário responsável e participante da tarefa automática; sem FK para preservar o mock de desenvolvimento da Agenda.';
comment on column public.oraculo_full_planning_configs.last_error is 'Último erro isolado da loja; um canal com falha não impede as demais tarefas.';

create table if not exists public.oraculo_full_planning_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  configs_processed integer not null default 0,
  tasks_created integer not null default 0,
  tasks_updated integer not null default 0,
  suggestions_written integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists oraculo_full_planning_runs_started_idx
  on public.oraculo_full_planning_runs (started_at desc);

alter table public.oraculo_full_planning_runs enable row level security;
revoke all on table public.oraculo_full_planning_runs from public, anon, authenticated;
grant all on table public.oraculo_full_planning_runs to service_role;

comment on table public.oraculo_full_planning_runs is
  'Auditoria da rotina diária agenda-full-planner que recalcula sugestões de envio e materializa as próximas coletas na Agenda.';
comment on column public.oraculo_full_planning_runs.status is 'running | success | partial (uma ou mais lojas falharam) | failed.';

-- A Amazon ainda não possui SP-API ativa no Oráculo. Esta RPC explicita a
-- fonte disponível: venda fiscal Amazon + saldo do depósito Amazon Onsite no
-- Olist. Quantidade local limita o que pode ser sugerido para transferência.
create or replace function public.oraculo_amazon_full_candidates()
returns table (
  sku text,
  title text,
  sold_qty_30d numeric,
  sold_qty_60d numeric,
  onsite_stock numeric,
  local_available numeric,
  last_sale_day date
)
language sql
stable
security definer
set search_path = public
as $$
  with sales as (
    select
      nullif(btrim(ii.sku), '') as sku,
      max(nullif(btrim(ii.description), '')) as title,
      coalesce(sum(ii.quantity) filter (where inv.issued_date >= current_date - 29), 0) as sold_qty_30d,
      coalesce(sum(ii.quantity) filter (where inv.issued_date >= current_date - 59), 0) as sold_qty_60d,
      max(inv.issued_date) filter (where ii.quantity > 0) as last_sale_day
    from public.oraculo_fiscal_invoices_valid inv
    join public.olist_invoice_items ii on ii.invoice_id = inv.id
    where inv.issued_date >= current_date - 59
      and inv.channel_label ilike '%amazon%'
      and nullif(btrim(ii.sku), '') is not null
    group by nullif(btrim(ii.sku), '')
  ), onsite as (
    select nullif(btrim(sd.sku), '') as sku,
           sum(greatest(coalesce(sd.disponivel, sd.saldo, 0), 0)) as onsite_stock
    from public.olist_stock_deposits sd
    where sd.deposito_id = '341912289'
    group by nullif(btrim(sd.sku), '')
  ), local_stock as (
    select nullif(btrim(i.sku), '') as sku,
           max(greatest(coalesce(i.disponivel, 0), 0)) as local_available
    from public.olist_stock_items i
    where i.active
    group by nullif(btrim(i.sku), '')
  )
  select
    s.sku,
    coalesce(nullif(p.nome, ''), s.title, s.sku) as title,
    s.sold_qty_30d,
    s.sold_qty_60d,
    coalesce(o.onsite_stock, 0),
    coalesce(l.local_available, 0),
    s.last_sale_day
  from sales s
  left join onsite o on lower(o.sku) = lower(s.sku)
  left join local_stock l on lower(l.sku) = lower(s.sku)
  left join public.olist_products p on lower(nullif(btrim(p.sku), '')) = lower(s.sku)
  where coalesce(p.tipo, '') <> 'K';
$$;

revoke all on function public.oraculo_amazon_full_candidates() from public, anon, authenticated;
grant execute on function public.oraculo_amazon_full_candidates() to service_role;

comment on function public.oraculo_amazon_full_candidates() is
  'Candidatos Amazon para planejamento Full: unidades faturadas nos últimos 30/60 dias (NF válida, channel_label Amazon), saldo no depósito Olist Amazon Onsite e disponível local. Não é dado da SP-API; use até a integração Amazon estar ativa.';

-- Descobre as lojas já conectadas, mas deixa a automação desligada até alguém
-- definir o dia real de coleta e o responsável na Agenda.
insert into public.oraculo_full_planning_configs (channel, store_key, store_name)
select 'shopee', s.shop_id::text, coalesce(nullif(s.shop_name, ''), s.shop_id::text)
from public.shopee_shops s
where s.is_active = true
on conflict (channel, store_key) do update set store_name = excluded.store_name;

insert into public.oraculo_full_planning_configs (channel, store_key, store_name)
select 'mercadolivre', a.seller_id::text, coalesce(nullif(a.nickname, ''), a.seller_id::text)
from public.mercadolivre_accounts a
where a.is_active = true
on conflict (channel, store_key) do update set store_name = excluded.store_name;

insert into public.oraculo_full_planning_configs (channel, store_key, store_name)
values ('amazon', 'amazon-onsite', 'Amazon Onsite')
on conflict (channel, store_key) do update set store_name = excluded.store_name;

-- Acionamento manual pela Agenda sem expor o segredo do cron ao app web.
create or replace function public.oraculo_queue_full_planner()
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  return private.invoke_shopee_function('agenda-full-planner', 300000);
end;
$$;

revoke all on function public.oraculo_queue_full_planner() from public, anon, authenticated;
grant execute on function public.oraculo_queue_full_planner() to service_role;
comment on function public.oraculo_queue_full_planner() is
  'Enfileira execução imediata da Edge Function agenda-full-planner via pg_net usando o segredo interno já guardado no Vault. Somente service_role.';

do $$
begin
  perform cron.unschedule('oraculo-agenda-full-planner-daily');
exception when others then null;
end $$;

-- 07:05 BRT: depois dos syncs noturnos e antes do início da operação.
select cron.schedule(
  'oraculo-agenda-full-planner-daily',
  '5 10 * * *',
  $$ select private.invoke_shopee_function('agenda-full-planner', 300000); $$
);
