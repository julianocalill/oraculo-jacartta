-- Snapshot quase em tempo real das quatro lojas Shopee. A coleta usa somente
-- order.get_order_list/get_order_detail da Open Platform, uma loja por Edge
-- Function. O browser nunca recebe tokens nem chama a Shopee diretamente.

begin;

create table if not exists public.shopee_live_monitor_snapshots (
  shop_id bigint primary key references public.shopee_shops(shop_id) on delete cascade,
  shop_name text,
  today_date date,
  previous_date date,
  status text not null default 'pending' check (status in ('pending', 'success', 'partial', 'failed')),
  is_complete boolean not null default false,
  current_metrics jsonb not null default '{"gross":0,"orders":0,"units":0,"buyers":0}'::jsonb,
  previous_metrics jsonb not null default '{"gross":0,"orders":0,"units":0,"buyers":0}'::jsonb,
  hourly jsonb not null default '[]'::jsonb,
  products jsonb not null default '[]'::jsonb,
  source_orders integer not null default 0,
  api_through_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  error_message text,
  updated_at timestamptz not null default now()
);

alter table public.shopee_live_monitor_snapshots enable row level security;
revoke all on public.shopee_live_monitor_snapshots from public, anon, authenticated;
grant select, insert, update, delete on public.shopee_live_monitor_snapshots to service_role;

create index if not exists shopee_live_monitor_snapshots_success_idx
  on public.shopee_live_monitor_snapshots(last_success_at desc);

comment on table public.shopee_live_monitor_snapshots is
  'Último snapshot do monitor de vendas por loja, coletado diretamente da Shopee Open Platform. Service-role only: a página autenticada lê no servidor e nunca recebe credenciais.';
comment on column public.shopee_live_monitor_snapshots.current_metrics is
  'JSON agregado do dia BRT: gross, orders, units e buyers; exclui UNPAID, CANCELLED e IN_CANCEL.';
comment on column public.shopee_live_monitor_snapshots.hourly is
  'Série de 24 horas com GMV de hoje e do dia anterior em America/Sao_Paulo.';
comment on column public.shopee_live_monitor_snapshots.products is
  'Agregado sem PII por SKU/anúncio do dia: produto, variação, unidades, pedidos e GMV de itens.';
comment on column public.shopee_live_monitor_snapshots.is_complete is
  'Verdadeiro somente quando a paginação terminou sem alcançar o teto de segurança da função.';

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
create schema if not exists private;

create or replace function private.invoke_shopee_live_monitor(
  p_shop_id bigint,
  p_timeout_ms integer default 150000
)
returns bigint
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  project_url text;
  sync_secret text;
begin
  select decrypted_secret into project_url
  from vault.decrypted_secrets
  where name = 'oraculo_project_url'
  limit 1;

  select decrypted_secret into sync_secret
  from vault.decrypted_secrets
  where name = 'oraculo_shopee_sync_job_secret'
  limit 1;

  if project_url is null or sync_secret is null then
    raise exception 'Segredos do monitor Shopee ausentes no Vault';
  end if;
  if not exists (
    select 1 from public.shopee_shops where shop_id = p_shop_id and is_active
  ) then
    return null;
  end if;

  return net.http_post(
    url := project_url || '/functions/v1/shopee-live-monitor?shop_id=' || p_shop_id,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', sync_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout_ms
  );
end;
$$;

revoke all on function private.invoke_shopee_live_monitor(bigint, integer)
  from public, anon, authenticated;
grant execute on function private.invoke_shopee_live_monitor(bigint, integer)
  to service_role;
comment on function private.invoke_shopee_live_monitor(bigint, integer) is
  'Enfileira coleta read-only do monitor Shopee para uma loja. Usa segredo do Vault; não renova tokens.';

-- Uma loja por invocação e partner app; os minutos são escalonados para não
-- concentrar CPU nem chamadas. cron.schedule com nome fixo atualiza o job.
do $$
declare
  shop record;
  offset_minute integer := 0;
begin
  for shop in
    select shop_id
    from public.shopee_shops
    where is_active
    order by shop_id
  loop
    perform cron.schedule(
      'shopee-live-monitor-' || shop.shop_id,
      format('%s-59/5 * * * *', offset_minute),
      format('select private.invoke_shopee_live_monitor(%s);', shop.shop_id)
    );
    offset_minute := offset_minute + 1;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
