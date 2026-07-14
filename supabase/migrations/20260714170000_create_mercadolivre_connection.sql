-- Fundação da conexão Mercado Livre no Oráculo.
-- Nenhum pedido/produto é importado e nenhuma métrica existente é alterada.

create table if not exists public.mercadolivre_oauth_states (
  state text primary key,
  code_verifier text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mercadolivre_oauth_states_expires_at_idx
  on public.mercadolivre_oauth_states (expires_at);

create table if not exists public.mercadolivre_accounts (
  seller_id bigint primary key,
  site_id text,
  nickname text,
  email text,
  country_id text,
  is_active boolean not null default true,
  authorized_at timestamptz not null default now(),
  last_verified_at timestamptz,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mercadolivre_tokens (
  seller_id bigint primary key references public.mercadolivre_accounts (seller_id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  token_type text,
  scope text,
  expires_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mercadolivre_notifications (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  notification_id text,
  topic text not null,
  resource text not null,
  seller_id bigint,
  application_id bigint,
  attempts integer,
  sent_at timestamptz,
  received_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'ignored', 'failed')),
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists mercadolivre_notifications_status_created_at_idx
  on public.mercadolivre_notifications (status, created_at);

create index if not exists mercadolivre_notifications_seller_topic_idx
  on public.mercadolivre_notifications (seller_id, topic, created_at desc);

create table if not exists public.mercadolivre_connection_runs (
  id uuid primary key default gen_random_uuid(),
  seller_id bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  error_message text,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists mercadolivre_connection_runs_started_at_idx
  on public.mercadolivre_connection_runs (started_at desc);

alter table public.mercadolivre_oauth_states enable row level security;
alter table public.mercadolivre_accounts enable row level security;
alter table public.mercadolivre_tokens enable row level security;
alter table public.mercadolivre_notifications enable row level security;
alter table public.mercadolivre_connection_runs enable row level security;

revoke all on table public.mercadolivre_oauth_states from public, anon, authenticated;
revoke all on table public.mercadolivre_accounts from public, anon, authenticated;
revoke all on table public.mercadolivre_tokens from public, anon, authenticated;
revoke all on table public.mercadolivre_notifications from public, anon, authenticated;
revoke all on table public.mercadolivre_connection_runs from public, anon, authenticated;

grant all on table public.mercadolivre_oauth_states to service_role;
grant all on table public.mercadolivre_accounts to service_role;
grant all on table public.mercadolivre_tokens to service_role;
grant all on table public.mercadolivre_notifications to service_role;
grant all on table public.mercadolivre_connection_runs to service_role;

comment on table public.mercadolivre_tokens is
  'Credenciais rotativas do Mercado Livre. Somente service_role; nunca expor no frontend.';

comment on table public.mercadolivre_notifications is
  'Inbox idempotente de webhooks. O receptor persiste e responde; processamento é posterior.';
