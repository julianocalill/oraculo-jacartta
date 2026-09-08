-- Fluxo operacional de reposição inbound para Shopee FBS, Mercado Livre Full
-- e Amazon Onsite. Uberlândia nasce primeiro; Giracasa continua isolada e
-- desativada para este módulo até ter catálogo, responsáveis e conectores.
--
-- Escrita é exclusiva do service_role pelas Server Actions/Edge Functions.
-- Leitura usa RLS por participante, com exceção explícita para gestores Full
-- cadastrados em app_metadata.operations.uberlandia.full_manager.

begin;
set local lock_timeout = '5s';

-- -------------------------------------------------------------------------
-- Permissão gerencial e helper RLS
-- -------------------------------------------------------------------------

create schema if not exists oraculo_private;
revoke all on schema oraculo_private from public, anon;
grant usage on schema oraculo_private to authenticated, service_role;

create or replace function oraculo_private.is_full_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = (select auth.uid())
       and (u.banned_until is null or u.banned_until < now())
       and coalesce(
         (u.raw_app_meta_data->'operations'->'uberlandia'->>'full_manager')::boolean,
         false
       )
  );
$$;

revoke all on function oraculo_private.is_full_manager() from public, anon;
grant execute on function oraculo_private.is_full_manager() to authenticated, service_role;
comment on function oraculo_private.is_full_manager() is
  'Confere no app_metadata administrado pelo servidor se o usuário é gestor do fluxo Full de Uberlândia. Não lê user_metadata.';

-- Administradores fixos começam como gestores Full. A tela /usuarios passa a
-- preservar e editar este campo para os demais usuários.
update auth.users
   set raw_app_meta_data = jsonb_set(
     coalesce(raw_app_meta_data, '{}'::jsonb),
     '{operations,uberlandia,full_manager}',
     'true'::jsonb,
     true
   )
 where lower(email) in ('juliano@oliverhome.com.br', 'oliveiros_cardoso@hotmail.com');

-- Quem já operava Agenda ou Logística recebe a nova aba Full em Uberlândia.
update auth.users u
   set raw_app_meta_data = jsonb_set(
     u.raw_app_meta_data,
     '{operations,uberlandia,tabs}',
     coalesce(u.raw_app_meta_data->'operations'->'uberlandia'->'tabs', '[]'::jsonb) || '"full"'::jsonb,
     true
   )
 where u.raw_app_meta_data ? 'operations'
   and coalesce((u.raw_app_meta_data->'operations'->'uberlandia'->>'enabled')::boolean, false)
   and (
     u.raw_app_meta_data->'operations'->'uberlandia'->'tabs' ? 'agenda'
     or u.raw_app_meta_data->'operations'->'uberlandia'->'tabs' ? 'logistica'
   )
   and not (coalesce(u.raw_app_meta_data->'operations'->'uberlandia'->'tabs', '[]'::jsonb) ? 'full');

-- -------------------------------------------------------------------------
-- Configuração por loja e capacidade de integração
-- -------------------------------------------------------------------------

create table public.oraculo_full_store_configs (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null default 'uberlandia' check (operation_id = 'uberlandia'),
  channel text not null check (channel in ('shopee', 'mercadolivre', 'amazon')),
  store_key text not null,
  store_name text not null,
  default_logistics_user_id uuid,
  catalog_enabled boolean not null default true,
  collection_sync_validated boolean not null default false,
  receipt_sync_validated boolean not null default false,
  submission_enabled boolean generated always as
    (catalog_enabled and collection_sync_validated and receipt_sync_validated) stored,
  validation_note text,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_id, channel, store_key)
);

create index oraculo_full_store_configs_submission_idx
  on public.oraculo_full_store_configs (channel, submission_enabled, store_name);

insert into public.oraculo_full_store_configs
  (channel, store_key, store_name, validation_note)
select 'shopee', s.shop_id::text, coalesce(nullif(s.shop_name, ''), 'Shopee ' || s.shop_id::text),
       'FBS por remessa ainda precisa ser validado em uma operação real.'
  from public.shopee_shops s
 where s.is_active
on conflict (operation_id, channel, store_key) do update
set store_name = excluded.store_name,
    updated_at = now();

insert into public.oraculo_full_store_configs
  (channel, store_key, store_name, validation_note)
select 'mercadolivre', a.seller_id::text, coalesce(nullif(a.nickname, ''), 'Mercado Livre ' || a.seller_id::text),
       'Operações inbound_reception precisam ser validadas em uma remessa real antes da liberação.'
  from public.mercadolivre_accounts a
 where a.is_active
on conflict (operation_id, channel, store_key) do update
set store_name = excluded.store_name,
    updated_at = now();

insert into public.oraculo_full_store_configs
  (channel, store_key, store_name, validation_note)
values (
  'amazon', 'amazon-onsite', 'Amazon Onsite',
  'SP-API e leitura de remessas inbound ainda não estão habilitadas para esta operação.'
)
on conflict (operation_id, channel, store_key) do nothing;

insert into public.oraculo_full_store_configs
  (channel, store_key, store_name, default_logistics_user_id)
select channel, store_key, store_name, assignee_user_id
  from public.oraculo_full_planning_configs
on conflict (operation_id, channel, store_key) do update
set store_name = excluded.store_name,
    default_logistics_user_id = excluded.default_logistics_user_id,
    updated_at = now();

comment on table public.oraculo_full_store_configs is 'Configuração do fluxo Full por loja e gates de ativação dos conectores automáticos; Uberlândia somente nesta fase.';
comment on column public.oraculo_full_store_configs.operation_id is 'Operação proprietária. Nesta primeira fase aceita somente uberlandia.';
comment on column public.oraculo_full_store_configs.channel is 'Marketplace: shopee, mercadolivre ou amazon.';
comment on column public.oraculo_full_store_configs.store_key is 'Identificador estável da loja na fonte do canal.';
comment on column public.oraculo_full_store_configs.store_name is 'Nome congelado para seleção operacional.';
comment on column public.oraculo_full_store_configs.default_logistics_user_id is 'Responsável logístico sugerido ao criar um Full; pode ser trocado no rascunho.';
comment on column public.oraculo_full_store_configs.catalog_enabled is 'Indica que o catálogo da loja pode ser usado para criar rascunhos.';
comment on column public.oraculo_full_store_configs.collection_sync_validated is 'True somente depois de uma remessa real provar detecção automática de coleta.';
comment on column public.oraculo_full_store_configs.receipt_sync_validated is 'True somente depois de uma remessa real provar recebimento automático por item.';
comment on column public.oraculo_full_store_configs.submission_enabled is 'Gate calculado: só permite enviar à logística quando catálogo, coleta e recebimento automáticos estão validados.';
comment on column public.oraculo_full_store_configs.validation_note is 'Evidência ou impedimento da última validação do conector.';
comment on column public.oraculo_full_store_configs.validated_at is 'Momento da última validação real do conector.';
comment on column public.oraculo_full_store_configs.created_at is 'Criação da configuração.';
comment on column public.oraculo_full_store_configs.updated_at is 'Última alteração da configuração.';

-- -------------------------------------------------------------------------
-- Cabeçalho, participantes e revisões
-- -------------------------------------------------------------------------

create table public.oraculo_fulls (
  id uuid primary key default gen_random_uuid(),
  number bigint generated by default as identity unique,
  operation_id text not null default 'uberlandia' check (operation_id = 'uberlandia'),
  channel text not null check (channel in ('shopee', 'mercadolivre', 'amazon')),
  store_key text not null,
  store_name text not null,
  creator_user_id uuid not null,
  logistics_user_id uuid not null,
  workflow_status text not null default 'rascunho' check (workflow_status in (
    'rascunho','aguardando_logistica','aguardando_criador','aguardando_agendamento',
    'monitorando','concluido','cancelado','excecao'
  )),
  production_status text not null default 'nao_iniciada' check (production_status in (
    'nao_iniciada','em_producao','pronta','com_falta'
  )),
  external_status text not null default 'nao_vinculado' check (external_status in (
    'nao_vinculado','agendado','coletado','em_transito','recebendo','recebido',
    'recebido_com_divergencia','cancelado','desconhecido'
  )),
  current_revision integer not null default 1 check (current_revision > 0),
  proposed_pickup_day date,
  proposed_pickup_note text,
  proposed_by uuid,
  proposed_at timestamptz,
  approved_pickup_day date,
  approved_by uuid,
  approved_at timestamptz,
  external_shipment_id text,
  shipping_mode text,
  scheduled_pickup_day date,
  external_collected_at timestamptz,
  external_received_at timestamptz,
  last_external_sync_at timestamptz,
  last_external_error text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, store_key, external_shipment_id)
);

create index oraculo_fulls_queue_idx
  on public.oraculo_fulls (workflow_status, updated_at desc)
  where workflow_status not in ('concluido','cancelado');
create index oraculo_fulls_creator_idx on public.oraculo_fulls (creator_user_id, created_at desc);
create index oraculo_fulls_logistics_idx on public.oraculo_fulls (logistics_user_id, created_at desc);
create index oraculo_fulls_external_sync_idx
  on public.oraculo_fulls (channel, store_key, last_external_sync_at)
  where workflow_status = 'monitorando';

create table public.oraculo_full_participants (
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  user_id uuid not null,
  participant_role text not null check (participant_role in ('criador','logistica','participante')),
  created_at timestamptz not null default now(),
  primary key (full_id, user_id)
);
create index oraculo_full_participants_user_idx
  on public.oraculo_full_participants (user_id, full_id);

create or replace function oraculo_private.can_read_full(p_full_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select oraculo_private.is_full_manager())
    or exists (
      select 1
        from public.oraculo_full_participants p
       where p.full_id = p_full_id
         and p.user_id = (select auth.uid())
    );
$$;
revoke all on function oraculo_private.can_read_full(uuid) from public, anon;
grant execute on function oraculo_private.can_read_full(uuid) to authenticated, service_role;
comment on function oraculo_private.can_read_full(uuid) is 'Autoriza leitura do Full ao participante da linha ou ao gestor Full da operação.';

create table public.oraculo_full_revisions (
  id uuid primary key default gen_random_uuid(),
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  frozen_at timestamptz,
  unique (full_id, revision_no)
);
create index oraculo_full_revisions_full_idx on public.oraculo_full_revisions (full_id, revision_no desc);

create table public.oraculo_full_revision_items (
  id uuid primary key default gen_random_uuid(),
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  revision_id uuid not null references public.oraculo_full_revisions(id) on delete cascade,
  channel_item_key text not null,
  channel_item_id text,
  channel_model_id text,
  marketplace_sku text,
  marketplace_title text not null,
  marketplace_variation text,
  selected_olist_product_id text not null,
  selected_olist_sku text not null,
  selected_olist_title text not null,
  selected_olist_is_kit boolean not null default false,
  requested_qty integer not null check (requested_qty > 0),
  position integer not null default 0,
  unique (revision_id, channel_item_key)
);
create index oraculo_full_revision_items_full_idx on public.oraculo_full_revision_items (full_id, revision_id);

create table public.oraculo_full_revision_components (
  id uuid primary key default gen_random_uuid(),
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  revision_id uuid not null references public.oraculo_full_revisions(id) on delete cascade,
  revision_item_id uuid not null references public.oraculo_full_revision_items(id) on delete cascade,
  olist_product_id text,
  olist_sku text not null,
  olist_title text not null,
  units_per_marketplace numeric not null default 1 check (units_per_marketplace > 0),
  required_qty integer not null check (required_qty > 0)
);
create index oraculo_full_revision_components_full_idx
  on public.oraculo_full_revision_components (full_id, revision_id);
create index oraculo_full_revision_components_item_idx
  on public.oraculo_full_revision_components (revision_item_id);

create table public.oraculo_full_production_lines (
  id uuid primary key default gen_random_uuid(),
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  olist_sku text not null,
  olist_title text not null,
  required_qty integer not null check (required_qty >= 0),
  active boolean not null default true,
  ready_qty integer not null default 0 check (ready_qty >= 0),
  shortage_qty integer not null default 0 check (shortage_qty >= 0),
  shortage_note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (full_id, olist_sku)
);
create index oraculo_full_production_lines_full_idx on public.oraculo_full_production_lines (full_id);

create table public.oraculo_full_production_updates (
  id bigint generated always as identity primary key,
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  production_line_id uuid not null references public.oraculo_full_production_lines(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  ready_qty integer not null check (ready_qty >= 0),
  shortage_qty integer not null default 0 check (shortage_qty >= 0),
  note text,
  actor_user_id uuid not null,
  created_at timestamptz not null default now()
);
create index oraculo_full_production_updates_full_idx
  on public.oraculo_full_production_updates (full_id, created_at desc);
create index oraculo_full_production_updates_line_idx
  on public.oraculo_full_production_updates (production_line_id, created_at desc);

-- Uma revisão muda itens, componentes e necessidade de produção como uma
-- unidade atômica. Se qualquer linha for inválida, a transação inteira falha.
create or replace function public.oraculo_write_full_revision(
  p_full_id uuid,
  p_revision_no integer,
  p_created_by uuid,
  p_reason text,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision_id uuid;
  v_item_id uuid;
  v_row jsonb;
  v_component jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Full revision requires at least one item';
  end if;

  insert into public.oraculo_full_revisions (full_id, revision_no, reason, created_by)
  values (p_full_id, p_revision_no, p_reason, p_created_by)
  returning id into v_revision_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.oraculo_full_revision_items (
      full_id, revision_id, channel_item_key, channel_item_id, channel_model_id,
      marketplace_sku, marketplace_title, marketplace_variation,
      selected_olist_product_id, selected_olist_sku, selected_olist_title,
      selected_olist_is_kit, requested_qty, position
    ) values (
      p_full_id, v_revision_id, v_row->>'channel_item_key', v_row->>'channel_item_id',
      v_row->>'channel_model_id', v_row->>'marketplace_sku', v_row->>'marketplace_title',
      v_row->>'marketplace_variation', v_row->>'selected_olist_product_id',
      v_row->>'selected_olist_sku', v_row->>'selected_olist_title',
      coalesce((v_row->>'selected_olist_is_kit')::boolean, false),
      (v_row->>'requested_qty')::integer, (v_row->>'position')::integer
    ) returning id into v_item_id;

    for v_component in select value from jsonb_array_elements(v_row->'components')
    loop
      insert into public.oraculo_full_revision_components (
        full_id, revision_id, revision_item_id, olist_product_id, olist_sku,
        olist_title, units_per_marketplace, required_qty
      ) values (
        p_full_id, v_revision_id, v_item_id, v_component->>'olist_product_id',
        v_component->>'olist_sku', v_component->>'olist_title',
        (v_component->>'units_per_marketplace')::numeric,
        (v_component->>'required_qty')::integer
      );
    end loop;
  end loop;

  update public.oraculo_full_production_lines
     set active = false, required_qty = 0, updated_at = now()
   where full_id = p_full_id;

  insert into public.oraculo_full_production_lines (
    full_id, olist_sku, olist_title, required_qty, active
  )
  select p_full_id, c.olist_sku, min(c.olist_title), sum(c.required_qty)::integer, true
    from public.oraculo_full_revision_components c
   where c.revision_id = v_revision_id
   group by c.olist_sku
  on conflict (full_id, olist_sku) do update
    set olist_title = excluded.olist_title,
        required_qty = excluded.required_qty,
        active = true,
        updated_at = now();

  return v_revision_id;
end;
$$;
revoke all on function public.oraculo_write_full_revision(uuid, integer, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.oraculo_write_full_revision(uuid, integer, uuid, text, jsonb) to service_role;
comment on function public.oraculo_write_full_revision(uuid, integer, uuid, text, jsonb) is 'Grava atomicamente a fotografia comercial, expansão física e necessidade consolidada de uma nova revisão Full; RPC exclusiva do service_role.';

-- -------------------------------------------------------------------------
-- Documentos, timeline e sincronização externa
-- -------------------------------------------------------------------------

create table public.oraculo_full_attachments (
  id uuid primary key default gen_random_uuid(),
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  storage_bucket text not null default 'full-documents' check (storage_bucket = 'full-documents'),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 8388608),
  uploaded_by uuid not null,
  created_at timestamptz not null default now()
);
create index oraculo_full_attachments_full_idx on public.oraculo_full_attachments (full_id, created_at);

create table public.oraculo_full_events (
  id bigint generated always as identity primary key,
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  revision_no integer,
  event_type text not null,
  actor_type text not null check (actor_type in ('usuario','sistema')),
  actor_user_id uuid,
  from_status text,
  to_status text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((actor_type = 'usuario' and actor_user_id is not null) or actor_type = 'sistema')
);
create index oraculo_full_events_full_idx on public.oraculo_full_events (full_id, created_at desc, id desc);

create table public.oraculo_full_external_events (
  id uuid primary key default gen_random_uuid(),
  full_id uuid not null references public.oraculo_fulls(id) on delete cascade,
  channel text not null check (channel in ('shopee','mercadolivre','amazon')),
  external_event_key text not null,
  raw_status text not null,
  canonical_status text not null check (canonical_status in (
    'agendado','coletado','em_transito','recebendo','recebido',
    'recebido_com_divergencia','cancelado','desconhecido'
  )),
  shipped_qty integer,
  received_qty integer,
  observed_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (full_id, external_event_key)
);
create index oraculo_full_external_events_full_idx
  on public.oraculo_full_external_events (full_id, observed_at desc);

create table public.oraculo_full_sync_runs (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('shopee','mercadolivre','amazon')),
  store_key text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  records_checked integer not null default 0,
  events_written integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);
create index oraculo_full_sync_runs_source_idx
  on public.oraculo_full_sync_runs (channel, store_key, started_at desc);

-- Timeline e revisões congeladas nunca são reescritas, mesmo por engano com
-- service_role. Correção é sempre um novo evento/revisão.
create or replace function oraculo_private.reject_immutable_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;
comment on function oraculo_private.reject_immutable_change() is 'Bloqueia update/delete em tabelas append-only do Full.';

create trigger oraculo_full_events_immutable
before update or delete on public.oraculo_full_events
for each row execute function oraculo_private.reject_immutable_change();
create trigger oraculo_full_external_events_immutable
before update or delete on public.oraculo_full_external_events
for each row execute function oraculo_private.reject_immutable_change();
create trigger oraculo_full_production_updates_immutable
before update or delete on public.oraculo_full_production_updates
for each row execute function oraculo_private.reject_immutable_change();

create or replace function oraculo_private.protect_frozen_full_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_frozen timestamptz;
begin
  if tg_table_name = 'oraculo_full_revisions' then
    if tg_op = 'DELETE' and old.frozen_at is not null then
      raise exception 'frozen Full revision is immutable';
    end if;
    if tg_op = 'UPDATE' and old.frozen_at is not null then
      raise exception 'frozen Full revision is immutable';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select r.frozen_at into v_frozen
    from public.oraculo_full_revisions r
   where r.id = coalesce(new.revision_id, old.revision_id);
  if v_frozen is not null then
    raise exception 'items of a frozen Full revision are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
comment on function oraculo_private.protect_frozen_full_revision() is 'Permite editar rascunho e bloqueia alteração/exclusão de revisão e itens após o envio à logística.';

create trigger oraculo_full_revisions_frozen
before update or delete on public.oraculo_full_revisions
for each row execute function oraculo_private.protect_frozen_full_revision();
create trigger oraculo_full_revision_items_frozen
before update or delete on public.oraculo_full_revision_items
for each row execute function oraculo_private.protect_frozen_full_revision();
create trigger oraculo_full_revision_components_frozen
before update or delete on public.oraculo_full_revision_components
for each row execute function oraculo_private.protect_frozen_full_revision();

-- -------------------------------------------------------------------------
-- RLS e grants explícitos (Data API não herda grants automaticamente)
-- -------------------------------------------------------------------------

alter table public.oraculo_full_store_configs enable row level security;
alter table public.oraculo_fulls enable row level security;
alter table public.oraculo_full_participants enable row level security;
alter table public.oraculo_full_revisions enable row level security;
alter table public.oraculo_full_revision_items enable row level security;
alter table public.oraculo_full_revision_components enable row level security;
alter table public.oraculo_full_production_lines enable row level security;
alter table public.oraculo_full_production_updates enable row level security;
alter table public.oraculo_full_attachments enable row level security;
alter table public.oraculo_full_events enable row level security;
alter table public.oraculo_full_external_events enable row level security;
alter table public.oraculo_full_sync_runs enable row level security;

revoke all on public.oraculo_full_store_configs, public.oraculo_fulls,
  public.oraculo_full_participants, public.oraculo_full_revisions,
  public.oraculo_full_revision_items, public.oraculo_full_revision_components,
  public.oraculo_full_production_lines, public.oraculo_full_production_updates,
  public.oraculo_full_attachments, public.oraculo_full_events,
  public.oraculo_full_external_events, public.oraculo_full_sync_runs
from public, anon, authenticated;

grant all on public.oraculo_full_store_configs, public.oraculo_fulls,
  public.oraculo_full_participants, public.oraculo_full_revisions,
  public.oraculo_full_revision_items, public.oraculo_full_revision_components,
  public.oraculo_full_production_lines, public.oraculo_full_production_updates,
  public.oraculo_full_attachments, public.oraculo_full_events,
  public.oraculo_full_external_events, public.oraculo_full_sync_runs
to service_role;
grant usage, select on sequence public.oraculo_fulls_number_seq,
  public.oraculo_full_production_updates_id_seq, public.oraculo_full_events_id_seq
to service_role;

grant select on public.oraculo_full_store_configs, public.oraculo_fulls,
  public.oraculo_full_participants, public.oraculo_full_revisions,
  public.oraculo_full_revision_items, public.oraculo_full_revision_components,
  public.oraculo_full_production_lines, public.oraculo_full_production_updates,
  public.oraculo_full_attachments, public.oraculo_full_events,
  public.oraculo_full_external_events
to authenticated;

create policy oraculo_full_store_configs_read on public.oraculo_full_store_configs
for select to authenticated using ((select oraculo_private.can_access_operation('uberlandia')));

create policy oraculo_fulls_read on public.oraculo_fulls
for select to authenticated using ((select oraculo_private.can_read_full(id)));
create policy oraculo_full_participants_read on public.oraculo_full_participants
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));
create policy oraculo_full_revisions_read on public.oraculo_full_revisions
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));
create policy oraculo_full_revision_items_read on public.oraculo_full_revision_items
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));
create policy oraculo_full_revision_components_read on public.oraculo_full_revision_components
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));
create policy oraculo_full_production_lines_read on public.oraculo_full_production_lines
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));
create policy oraculo_full_production_updates_read on public.oraculo_full_production_updates
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));
create policy oraculo_full_attachments_read on public.oraculo_full_attachments
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));
create policy oraculo_full_events_read on public.oraculo_full_events
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));
create policy oraculo_full_external_events_read on public.oraculo_full_external_events
for select to authenticated using ((select oraculo_private.can_read_full(full_id)));

-- -------------------------------------------------------------------------
-- Comentários dos objetos operacionais
-- -------------------------------------------------------------------------

comment on table public.oraculo_fulls is 'Fonte de verdade de cada reposição real para Shopee FBS, Mercado Livre Full ou Amazon Onsite.';
comment on column public.oraculo_fulls.number is 'Número sequencial humano exibido como FULL-000001.';
comment on column public.oraculo_fulls.workflow_status is 'Estado da responsabilidade e aprovação; independente da produção e do status externo.';
comment on column public.oraculo_fulls.production_status is 'Resumo derivado das linhas físicas: não iniciada, em produção, pronta ou com falta.';
comment on column public.oraculo_fulls.external_status is 'Estado canônico observado automaticamente no marketplace; nunca inferido por saldo agregado.';
comment on column public.oraculo_fulls.current_revision is 'Número da revisão atual; revisões congeladas não são reescritas.';
comment on column public.oraculo_fulls.external_shipment_id is 'Código informado após criar manualmente a remessa no marketplace.';
comment on column public.oraculo_fulls.last_external_error is 'Última falha ou status não reconhecido do conector, sem segredos.';
comment on table public.oraculo_full_participants is 'Usuários que podem ler um Full; gestores Full enxergam todos via policy separada.';
comment on table public.oraculo_full_revisions is 'Versões do pedido de reposição; frozen_at torna a versão e seus itens imutáveis.';
comment on table public.oraculo_full_revision_items is 'Fotografia imutável dos anúncios/variações e quantidades comerciais de uma revisão.';
comment on table public.oraculo_full_revision_components is 'Produtos físicos Olist confirmados para cada item comercial, incluindo expansão de kits.';
comment on table public.oraculo_full_production_lines is 'Necessidade física consolidada por SKU e progresso atual preservado entre revisões.';
comment on column public.oraculo_full_production_lines.active is 'False quando uma nova revisão remove o SKU; o progresso anterior permanece auditável.';
comment on table public.oraculo_full_production_updates is 'Histórico append-only de cada atualização de quantidade pronta ou faltante.';
comment on table public.oraculo_full_attachments is 'Metadados de documentos no bucket privado full-documents; o arquivo é acessado só por rota autorizada.';
comment on table public.oraculo_full_events is 'Linha do tempo append-only de criação, revisões, aprovações, produção, cancelamentos e exceções.';
comment on table public.oraculo_full_external_events is 'Observações idempotentes dos conectores, com status bruto e canônico por remessa.';
comment on table public.oraculo_full_sync_runs is 'Saúde das rotinas automáticas de coleta/recebimento, separada por canal e loja.';

-- -------------------------------------------------------------------------
-- Agenda legado: desliga sem apagar história
-- -------------------------------------------------------------------------

do $$
begin
  perform cron.unschedule('oraculo-agenda-full-planner-daily');
exception when others then null;
end $$;

update public.oraculo_full_planning_configs
   set enabled = false,
       last_error = 'Fluxo legado desativado em favor do módulo Full operacional.',
       updated_at = now()
 where enabled or last_error is distinct from 'Fluxo legado desativado em favor do módulo Full operacional.';

update public.oraculo_agenda_tasks
   set status = 'concluida',
       completed_at = now(),
       completed_by = null,
       description = concat_ws(E'\n', description, 'Encerrada automaticamente: sugestão do fluxo legado desativado; conteúdo preservado para auditoria.'),
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('legacy_flow_retired', true, 'retired_at', now()),
       updated_at = now()
 where task_kind = 'full_replenishment'
   and status = 'pendente';

alter table public.oraculo_agenda_tasks
  drop constraint if exists oraculo_agenda_tasks_task_kind_check;
alter table public.oraculo_agenda_tasks
  add constraint oraculo_agenda_tasks_task_kind_check
  check (task_kind in ('manual','full_replenishment','full_workflow'));

comment on column public.oraculo_agenda_tasks.task_kind is
  'manual | full_replenishment (legado desativado) | full_workflow (ação ou marco vinculado ao módulo Full).';

commit;
