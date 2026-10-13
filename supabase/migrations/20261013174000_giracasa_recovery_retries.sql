-- Recuperação SP: 429/5xx são falhas transitórias, não conclusão de histórico.
-- Estado de ingestão permanece service_role-only (sem dados de tela via JWT).
alter table giracasa.oraculo_item_recovery_state
  add column if not exists errors bigint not null default 0;
comment on column giracasa.oraculo_item_recovery_state.errors is 'Pedidos com erro ainda não resolvido na janela de recuperação. Incluídos em pending; completed_at só é preenchido sem pendências nem erros.';

create or replace function oraculo_private.run_giracasa_item_recovery_tick()
returns bigint language plpgsql security definer set search_path='' as $fn$
declare
  state giracasa.oraculo_item_recovery_state;
  candidates_count bigint;
  errors_count bigint;
  today_brt date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not pg_try_advisory_xact_lock(hashtext('giracasa-item-recovery')) then return null; end if;
  if exists(select 1 from giracasa.olist_order_items_backfill_runs where status='running' and started_at>now()-interval '110 seconds') then return null; end if;
  select * into state from giracasa.oraculo_item_recovery_state where id;
  if state.completed_at is not null then
    update giracasa.oraculo_item_recovery_state set window_start=today_brt-7,window_end=today_brt,completed_at=null where id
    returning * into state;
  end if;
  perform giracasa.prepare_olist_order_item_backfill_queue_by_orders(state.window_start,state.window_end);

  -- Retentativas limitadas e espaçadas. Erros permanentes ficam visíveis,
  -- sem bloquear os pedidos seguintes e sem certificar uma conclusão falsa.
  update giracasa.olist_order_item_backfill_queue
  set status='pending', processed_at=null, updated_at=now()
  where window_start=state.window_start and window_end=state.window_end
    and status='error' and attempts<6 and updated_at<now()-interval '10 minutes'
    and last_error ~ 'falhou \((429|5[0-9]{2})\)';

  candidates_count := giracasa.oraculo_fiscal_order_item_backfill_candidate_count(state.window_start,state.window_end);
  select count(*) into errors_count from giracasa.olist_order_item_backfill_queue
  where window_start=state.window_start and window_end=state.window_end and status='error';
  update giracasa.oraculo_item_recovery_state
  set pending=candidates_count+errors_count, errors=errors_count,
      completed_at=case when candidates_count+errors_count=0 then now() else null end
  where id;
  if candidates_count=0 then return null; end if;
  update giracasa.oraculo_item_recovery_state set last_dispatched_at=now() where id;
  return oraculo_private.invoke_giracasa_olist_function('giracasa-olist-backfill-order-items',
    jsonb_build_object('startDate',state.window_start,'endDate',state.window_end,'limit',35,'delayMs',1800,'maxRuntimeMs',90000),120000);
end $fn$;
revoke all on function oraculo_private.run_giracasa_item_recovery_tick() from public,anon,authenticated;
grant execute on function oraculo_private.run_giracasa_item_recovery_tick() to service_role;
comment on function oraculo_private.run_giracasa_item_recovery_tick() is 'Fila comercial SP: 35 pedidos/90s com intervalo de 1,8s. 429/5xx voltam à fila após 10 min até seis tentativas. Erros contam como pendência e impedem completed_at; preserva histórico de falhas e isolamento da operação.';

-- Faz o Status refletir imediatamente os erros já existentes; o próximo
-- cron executa as retentativas sem uma segunda chamada manual concorrente.
update giracasa.oraculo_item_recovery_state s
set errors=(select count(*) from giracasa.olist_order_item_backfill_queue q
  where q.window_start=s.window_start and q.window_end=s.window_end and q.status='error'),
    pending=(select count(*) from giracasa.olist_order_item_backfill_queue q
  where q.window_start=s.window_start and q.window_end=s.window_end and q.status in('pending','error')),
    completed_at=null
where id and exists(select 1 from giracasa.olist_order_item_backfill_queue q
  where q.window_start=s.window_start and q.window_end=s.window_end and q.status in('pending','error'));
