-- Acelera a carga temporária sem alterar os jobs permanentes de Uberlândia.
-- Medição real: uma página de 50 NFs concluiu em ~38 s; duas páginas cabem no
-- wall clock. Pedidos continuam em uma página porque 100 detalhes chegaram a
-- ~125 s. O acelerador intercala minutos livres com o coordenador original,
-- usa a mesma trava de linha e nunca dispara depois que a fase já concluiu.

create or replace function oraculo_private.run_giracasa_olist_initial_backfill_accelerator()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_control giracasa.olist_initial_backfill_control%rowtype;
  v_latest_status text;
  v_min_interval interval;
  v_request_id bigint;
  v_pending bigint;
begin
  select * into v_control
  from giracasa.olist_initial_backfill_control
  where id = 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'not_configured');
  end if;

  if v_control.status <> 'running' or v_control.phase = 'completed' then
    begin
      perform cron.unschedule('giracasa-olist-initial-backfill-accelerator');
    exception when others then null;
    end;
    return jsonb_build_object('ok', true, 'status', v_control.status, 'phase', v_control.phase);
  end if;

  v_min_interval := case
    when v_control.phase = 'orders' then interval '3 minutes'
    else interval '105 seconds'
  end;

  if v_control.last_dispatched_at is not null
     and v_control.last_dispatched_at > now() - v_min_interval then
    return jsonb_build_object(
      'ok', true,
      'status', 'waiting',
      'phase', v_control.phase,
      'last_dispatched_at', v_control.last_dispatched_at
    );
  end if;

  if v_control.phase = 'orders' then
    select r.status into v_latest_status
    from giracasa.olist_order_sync_runs r
    where r.window_start = v_control.current_start
      and r.window_end = v_control.current_end
    order by r.started_at desc
    limit 1;

    -- O coordenador principal promove success e contabiliza failed.
    if v_latest_status in ('success', 'failed') then
      return jsonb_build_object('ok', true, 'status', 'awaiting_coordinator', 'run_status', v_latest_status);
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
    select r.status into v_latest_status
    from giracasa.olist_invoice_sync_runs r
    where r.endpoint = 'notas'
      and r.window_start = v_control.current_start
      and r.window_end = v_control.current_end
    order by r.started_at desc
    limit 1;

    if v_latest_status in ('success', 'failed') then
      return jsonb_build_object('ok', true, 'status', 'awaiting_coordinator', 'run_status', v_latest_status);
    end if;

    v_request_id := oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-sync-invoices',
      jsonb_build_object(
        'endpoint', 'notas',
        'startDate', v_control.current_start,
        'endDate', v_control.current_end,
        'maxPages', 2,
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
      return jsonb_build_object('ok', true, 'status', 'awaiting_coordinator', 'pending', 0);
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
        'last_accelerated_phase', v_control.phase,
        'last_accelerated_request_id', v_request_id,
        'last_accelerated_at', now()
      )
  where id = 1;

  return jsonb_build_object(
    'ok', true,
    'status', 'dispatched',
    'phase', v_control.phase,
    'slice_number', v_control.slice_number,
    'request_id', v_request_id
  );
end;
$function$;

revoke all on function oraculo_private.run_giracasa_olist_initial_backfill_accelerator()
  from public, anon, authenticated;
grant execute on function oraculo_private.run_giracasa_olist_initial_backfill_accelerator()
  to service_role;
comment on function oraculo_private.run_giracasa_olist_initial_backfill_accelerator() is
  'Acelerador temporário da carga Giracasa: uma página de pedidos a cada ~4 min, duas páginas de NFs ou 100 itens a cada ~2 min, sem sobreposição.';

do $$
begin
  perform cron.unschedule('giracasa-olist-initial-backfill-accelerator');
exception when others then null;
end $$;

-- Minutos ímpares intercalados com o coordenador principal. 11 e 57 ficam
-- livres porque já possuem dois jobs recorrentes em parte do dia.
select cron.schedule(
  'giracasa-olist-initial-backfill-accelerator',
  '1,5,7,13,17,19,23,25,29,31,35,37,41,43,47,49,53,55,59 * * * *',
  $$select oraculo_private.run_giracasa_olist_initial_backfill_accelerator();$$
);

select oraculo_private.run_giracasa_olist_initial_backfill_accelerator();
