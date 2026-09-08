-- Carga inicial Olist da Giracasa executada integralmente no Supabase.
-- O pg_cron dispara uma página por vez nas Edge Functions já isoladas. O
-- estado vive no banco, portanto fechar o Codex ou desligar o computador não
-- interrompe o processo. O job se remove ao concluir ou após cinco falhas
-- consecutivas observadas na mesma fase.

create table if not exists giracasa.olist_initial_backfill_control (
  id smallint primary key default 1 check (id = 1),
  status text not null check (status in ('running', 'completed', 'failed', 'paused')),
  phase text not null check (phase in ('orders', 'invoices', 'order_items', 'completed')),
  requested_start date not null,
  requested_end date not null,
  slice_days integer not null default 14 check (slice_days between 1 and 14),
  slice_number integer not null default 1 check (slice_number > 0),
  current_start date not null,
  current_end date not null,
  last_dispatched_at timestamptz,
  last_request_id bigint,
  consecutive_failures integer not null default 0,
  last_failure_at timestamptz,
  last_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (requested_start <= requested_end),
  check (current_start <= current_end),
  check (current_start >= requested_start and current_end <= requested_end)
);

alter table giracasa.olist_initial_backfill_control enable row level security;
revoke all on table giracasa.olist_initial_backfill_control from public, anon, authenticated;
grant all on table giracasa.olist_initial_backfill_control to service_role;

comment on table giracasa.olist_initial_backfill_control is
  'Estado retomável da carga inicial Olist Giracasa. Alimentado por pg_cron e Edge Functions; service_role-only para não expor detalhes operacionais.';
comment on column giracasa.olist_initial_backfill_control.phase is
  'Etapa atual: pedidos por blocos de até 14 dias, notas nos mesmos blocos e itens comerciais vinculados às NFs válidas.';
comment on column giracasa.olist_initial_backfill_control.last_request_id is
  'Identificador do pg_net da última Edge Function disparada; permite auditoria sem depender da máquina do operador.';
comment on column giracasa.olist_initial_backfill_control.metadata is
  'Progresso observado e totais finais. Nunca contém tokens ou credenciais.';

create or replace function oraculo_private.invoke_giracasa_olist_function(
  p_function_name text,
  p_payload jsonb default '{}'::jsonb,
  p_timeout_milliseconds integer default 300000
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_project_url text;
  v_sync_secret text;
begin
  if p_function_name not in (
    'giracasa-olist-sync-orders',
    'giracasa-olist-sync-invoices',
    'giracasa-olist-backfill-order-items'
  ) then
    raise exception 'Função Giracasa não autorizada: %', p_function_name;
  end if;

  select decrypted_secret into v_project_url
  from vault.decrypted_secrets
  where name = 'oraculo_project_url'
  limit 1;

  select decrypted_secret into v_sync_secret
  from vault.decrypted_secrets
  where name = 'giracasa_olist_sync_job_secret'
  limit 1;

  if v_project_url is null or v_sync_secret is null then
    raise exception 'Vault sem oraculo_project_url ou giracasa_olist_sync_job_secret';
  end if;

  return net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', v_sync_secret
    ),
    body := p_payload,
    timeout_milliseconds := greatest(1000, least(coalesce(p_timeout_milliseconds, 300000), 300000))
  );
end;
$function$;

revoke all on function oraculo_private.invoke_giracasa_olist_function(text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function oraculo_private.invoke_giracasa_olist_function(text, jsonb, integer)
  to service_role;
comment on function oraculo_private.invoke_giracasa_olist_function(text, jsonb, integer) is
  'Despacha somente as três Edge Functions permitidas da carga inicial Giracasa, usando o segredo exclusivo armazenado no Vault.';

create or replace function oraculo_private.run_giracasa_olist_initial_backfill_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_control giracasa.olist_initial_backfill_control%rowtype;
  v_run_status text;
  v_run_finished_at timestamptz;
  v_run_error text;
  v_run_metadata jsonb;
  v_request_id bigint;
  v_pending bigint;
  v_completed bigint;
  v_problems bigint;
  v_failures integer;
  v_next_start date;
  v_next_end date;
begin
  select * into v_control
  from giracasa.olist_initial_backfill_control
  where id = 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_configured');
  end if;

  if v_control.status <> 'running' then
    return jsonb_build_object('ok', true, 'status', v_control.status, 'phase', v_control.phase);
  end if;

  if v_control.last_dispatched_at is not null
     and v_control.last_dispatched_at > now() - interval '4 minutes' then
    return jsonb_build_object(
      'ok', true,
      'status', 'waiting',
      'phase', v_control.phase,
      'last_dispatched_at', v_control.last_dispatched_at
    );
  end if;

  if v_control.phase = 'orders' then
    select r.status, r.finished_at, r.error_message, r.metadata
      into v_run_status, v_run_finished_at, v_run_error, v_run_metadata
    from giracasa.olist_order_sync_runs r
    where r.window_start = v_control.current_start
      and r.window_end = v_control.current_end
    order by r.started_at desc
    limit 1;

    if v_run_status = 'success' and coalesce((v_run_metadata->>'completed')::boolean, true) then
      update giracasa.olist_initial_backfill_control
      set phase = 'invoices',
          last_dispatched_at = null,
          last_request_id = null,
          consecutive_failures = 0,
          last_failure_at = null,
          last_error = null,
          updated_at = now(),
          metadata = metadata || jsonb_build_object(
            'orders_completed_through', v_control.current_end,
            'orders_last_total', coalesce((v_run_metadata->>'total_reported')::bigint, 0)
          )
      where id = 1;
      return jsonb_build_object('ok', true, 'status', 'advanced', 'phase', 'invoices');
    end if;

    if v_run_status = 'failed' then
      v_failures := case
        when v_control.last_failure_at is distinct from v_run_finished_at
          then v_control.consecutive_failures + 1
        else v_control.consecutive_failures
      end;
      if v_failures >= 5 then
        update giracasa.olist_initial_backfill_control
        set status = 'failed', consecutive_failures = v_failures,
            last_failure_at = v_run_finished_at, last_error = v_run_error,
            updated_at = now()
        where id = 1;
        perform cron.unschedule('giracasa-olist-initial-backfill-40d');
        return jsonb_build_object('ok', false, 'status', 'failed', 'phase', 'orders', 'error', v_run_error);
      end if;
      update giracasa.olist_initial_backfill_control
      set consecutive_failures = v_failures,
          last_failure_at = v_run_finished_at,
          last_error = v_run_error,
          updated_at = now()
      where id = 1;
    elsif v_run_status is distinct from 'failed' then
      update giracasa.olist_initial_backfill_control
      set consecutive_failures = 0, last_failure_at = null, last_error = null
      where id = 1;
    end if;

    v_request_id := oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-sync-orders',
      jsonb_build_object(
        'startDate', v_control.current_start,
        'endDate', v_control.current_end,
        'maxPages', 1,
        'pageSize', 100,
        'hydrateDetails', true,
        'resume', true
      ),
      300000
    );

  elsif v_control.phase = 'invoices' then
    select r.status, r.finished_at, r.error_message, r.metadata
      into v_run_status, v_run_finished_at, v_run_error, v_run_metadata
    from giracasa.olist_invoice_sync_runs r
    where r.endpoint = 'notas'
      and r.window_start = v_control.current_start
      and r.window_end = v_control.current_end
    order by r.started_at desc
    limit 1;

    if v_run_status = 'success' and coalesce((v_run_metadata->>'completed')::boolean, true) then
      if v_control.current_end < v_control.requested_end then
        v_next_start := v_control.current_end + 1;
        v_next_end := least(v_control.requested_end, v_next_start + (v_control.slice_days - 1));
        update giracasa.olist_initial_backfill_control
        set phase = 'orders',
            slice_number = slice_number + 1,
            current_start = v_next_start,
            current_end = v_next_end,
            last_dispatched_at = null,
            last_request_id = null,
            consecutive_failures = 0,
            last_failure_at = null,
            last_error = null,
            updated_at = now(),
            metadata = metadata || jsonb_build_object(
              'invoices_completed_through', v_control.current_end,
              'invoices_last_total', coalesce((v_run_metadata->>'total_reported')::bigint, 0)
            )
        where id = 1;
        return jsonb_build_object(
          'ok', true, 'status', 'advanced', 'phase', 'orders',
          'slice_number', v_control.slice_number + 1,
          'current_start', v_next_start, 'current_end', v_next_end
        );
      end if;

      perform giracasa.refresh_oraculo_fiscal_invoice_order_links(
        v_control.requested_start, v_control.requested_end
      );
      perform giracasa.prepare_olist_order_item_backfill_queue(
        v_control.requested_start, v_control.requested_end
      );
      update giracasa.olist_initial_backfill_control
      set phase = 'order_items',
          last_dispatched_at = null,
          last_request_id = null,
          consecutive_failures = 0,
          last_failure_at = null,
          last_error = null,
          updated_at = now(),
          metadata = metadata || jsonb_build_object(
            'invoices_completed_through', v_control.current_end,
            'invoices_last_total', coalesce((v_run_metadata->>'total_reported')::bigint, 0)
          )
      where id = 1;
      return jsonb_build_object('ok', true, 'status', 'advanced', 'phase', 'order_items');
    end if;

    if v_run_status = 'failed' then
      v_failures := case
        when v_control.last_failure_at is distinct from v_run_finished_at
          then v_control.consecutive_failures + 1
        else v_control.consecutive_failures
      end;
      if v_failures >= 5 then
        update giracasa.olist_initial_backfill_control
        set status = 'failed', consecutive_failures = v_failures,
            last_failure_at = v_run_finished_at, last_error = v_run_error,
            updated_at = now()
        where id = 1;
        perform cron.unschedule('giracasa-olist-initial-backfill-40d');
        return jsonb_build_object('ok', false, 'status', 'failed', 'phase', 'invoices', 'error', v_run_error);
      end if;
      update giracasa.olist_initial_backfill_control
      set consecutive_failures = v_failures,
          last_failure_at = v_run_finished_at,
          last_error = v_run_error,
          updated_at = now()
      where id = 1;
    elsif v_run_status is distinct from 'failed' then
      update giracasa.olist_initial_backfill_control
      set consecutive_failures = 0, last_failure_at = null, last_error = null
      where id = 1;
    end if;

    v_request_id := oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-sync-invoices',
      jsonb_build_object(
        'endpoint', 'notas',
        'startDate', v_control.current_start,
        'endDate', v_control.current_end,
        'maxPages', 1,
        'pageSize', 50,
        'hydrateDetails', true,
        'resume', true
      ),
      300000
    );

  elsif v_control.phase = 'order_items' then
    select giracasa.oraculo_fiscal_order_item_backfill_candidate_count(
      v_control.requested_start, v_control.requested_end
    ) into v_pending;

    if v_pending = 0 then
      select
        count(*) filter (where q.status = 'completed'),
        count(*) filter (where q.status in ('error', 'no_items'))
      into v_completed, v_problems
      from giracasa.olist_order_item_backfill_queue q
      where q.window_start = v_control.requested_start
        and q.window_end = v_control.requested_end;

      update giracasa.olist_initial_backfill_control
      set status = 'completed', phase = 'completed', completed_at = now(),
          last_dispatched_at = null, last_request_id = null,
          consecutive_failures = 0, last_failure_at = null,
          last_error = case when v_problems > 0
            then format('%s pedidos terminaram com error/no_items', v_problems)
            else null end,
          updated_at = now(),
          metadata = metadata || jsonb_build_object(
            'order_items_completed', v_completed,
            'order_items_problems', v_problems,
            'finished_at', now()
          )
      where id = 1;
      perform cron.unschedule('giracasa-olist-initial-backfill-40d');
      return jsonb_build_object(
        'ok', v_problems = 0, 'status', 'completed',
        'order_items_completed', v_completed, 'problems', v_problems
      );
    end if;

    v_request_id := oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-backfill-order-items',
      jsonb_build_object(
        'startDate', v_control.requested_start,
        'endDate', v_control.requested_end,
        'limit', 100,
        'delayMs', 50,
        'maxRuntimeMs', 120000
      ),
      300000
    );
  else
    return jsonb_build_object('ok', false, 'status', 'invalid_phase', 'phase', v_control.phase);
  end if;

  update giracasa.olist_initial_backfill_control
  set last_dispatched_at = now(),
      last_request_id = v_request_id,
      updated_at = now(),
      metadata = metadata || jsonb_build_object(
        'last_phase', v_control.phase,
        'last_slice_number', v_control.slice_number,
        'last_request_id', v_request_id,
        'last_dispatched_at', now()
      )
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'status', 'dispatched',
    'phase', v_control.phase,
    'slice_number', v_control.slice_number,
    'current_start', v_control.current_start,
    'current_end', v_control.current_end,
    'request_id', v_request_id
  );
end;
$function$;

revoke all on function oraculo_private.run_giracasa_olist_initial_backfill_tick()
  from public, anon, authenticated;
grant execute on function oraculo_private.run_giracasa_olist_initial_backfill_tick()
  to service_role;
comment on function oraculo_private.run_giracasa_olist_initial_backfill_tick() is
  'Máquina de estados da carga Olist Giracasa de 40 dias. Despacha uma página retomável por tick e remove o cron ao finalizar ou após cinco falhas consecutivas.';

insert into giracasa.olist_initial_backfill_control (
  id, status, phase, requested_start, requested_end, slice_days,
  slice_number, current_start, current_end, started_at, metadata
)
values (
  1, 'running', 'orders', date '2026-07-30', date '2026-09-07', 14,
  1, date '2026-07-30', date '2026-08-12', now(),
  jsonb_build_object('operation', 'giracasa', 'source', 'olist', 'history_days', 40)
)
on conflict (id) do update set
  status = excluded.status,
  phase = excluded.phase,
  requested_start = excluded.requested_start,
  requested_end = excluded.requested_end,
  slice_days = excluded.slice_days,
  slice_number = excluded.slice_number,
  current_start = excluded.current_start,
  current_end = excluded.current_end,
  last_dispatched_at = null,
  last_request_id = null,
  consecutive_failures = 0,
  last_failure_at = null,
  last_error = null,
  started_at = now(),
  completed_at = null,
  updated_at = now(),
  metadata = excluded.metadata;

do $$
begin
  perform cron.unschedule('giracasa-olist-initial-backfill-40d');
exception when others then null;
end $$;

select cron.schedule(
  'giracasa-olist-initial-backfill-40d',
  '3,9,15,21,27,33,39,45,51 * * * *',
  $$select oraculo_private.run_giracasa_olist_initial_backfill_tick();$$
);

-- Começa imediatamente; os ticks seguintes rodam no Supabase sem depender da
-- sessão local que aplicou a migration.
select oraculo_private.run_giracasa_olist_initial_backfill_tick();
