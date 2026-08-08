-- RPCs service-role-only para o n8n orquestrar o relatório sem conexão SQL
-- direta e sem colocar a service role nos parâmetros/nos dados de execução.

create or replace function public.shopee_ads_begin_report(
  p_trigger_source text default 'schedule',
  p_mode text default 'send',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_end date := (now() at time zone 'America/Sao_Paulo')::date - 1;
  v_run public.shopee_ads_report_runs%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_mode not in ('send', 'preview') then raise exception 'invalid mode'; end if;

  if p_mode = 'send' and not p_force and exists (
    select 1 from public.shopee_ads_report_runs prior
    where prior.mode = 'send'
      and prior.status in ('collecting', 'analyzing', 'ready', 'sent', 'partial')
      and prior.period_end >= v_period_end - 2
  ) then
    return jsonb_build_object('should_run', false, 'reason', 'three_day_guard', 'period_end', v_period_end);
  end if;

  insert into public.shopee_ads_report_runs (
    trigger_source, mode, period_start, period_end, status, stores_expected
  ) values (
    coalesce(nullif(p_trigger_source, ''), 'schedule'), p_mode,
    v_period_end - 2, v_period_end, 'collecting',
    (select count(*) from public.shopee_shops where is_active = true)
  ) returning * into v_run;

  return jsonb_build_object(
    'should_run', true,
    'run_id', v_run.id,
    'trigger_source', v_run.trigger_source,
    'mode', v_run.mode,
    'period_start', v_run.period_start,
    'period_end', v_run.period_end,
    'stores_expected', v_run.stores_expected
  );
end;
$$;

create or replace function public.shopee_ads_queue_report(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_run public.shopee_ads_report_runs%rowtype;
  v_requests jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  select * into v_run from public.shopee_ads_report_runs where id = p_run_id;
  if not found then raise exception 'report run not found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shop_id', s.shop_id,
    'request_id', private.invoke_shopee_ads_report_data(s.shop_id, v_run.period_end, 30, 300000)
  ) order by s.shop_id), '[]'::jsonb)
  into v_requests
  from public.shopee_shops s
  where s.is_active = true;

  return jsonb_build_object(
    'run_id', v_run.id,
    'mode', v_run.mode,
    'period_start', v_run.period_start,
    'period_end', v_run.period_end,
    'request_ids', v_requests
  );
end;
$$;

create or replace function public.shopee_ads_report_payload(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.shopee_ads_report_runs%rowtype;
  v_rows jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  select * into v_run from public.shopee_ads_report_runs where id = p_run_id;
  if not found then raise exception 'report run not found'; end if;

  update public.shopee_ads_report_runs set status = 'analyzing' where id = p_run_id;

  with dataset as (
    select * from public.shopee_ads_report_dataset(v_run.period_end)
  )
  select coalesce(jsonb_agg(to_jsonb(payload_row) order by shop_name, current_expense desc nulls last, campaign_id), '[]'::jsonb)
  into v_rows
  from (
    select
      v_run.id as run_id,
      v_run.mode,
      v_run.period_start,
      v_run.period_end,
      s.shop_id,
      s.shop_name,
      latest.status as collection_status,
      latest.error_message as collection_error,
      case when d.campaign_id is null then null else to_jsonb(d) end as campaign,
      d.current_expense,
      d.campaign_id
    from public.shopee_shops s
    left join dataset d on d.shop_id = s.shop_id
    left join lateral (
      select cr.status, cr.error_message
      from public.shopee_ads_collection_runs cr
      where cr.shop_id = s.shop_id and cr.period_end = v_run.period_end
      order by cr.started_at desc
      limit 1
    ) latest on true
    where s.is_active = true
  ) payload_row;

  return jsonb_build_object('run_id', v_run.id, 'rows', v_rows);
end;
$$;

create or replace function public.shopee_ads_save_message(
  p_run_id uuid,
  p_shop_id bigint,
  p_part_number integer,
  p_message_key text,
  p_message_text text,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.shopee_ads_report_messages%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  insert into public.shopee_ads_report_messages (
    run_id, shop_id, part_number, message_key, message_text, delivery_status
  ) values (
    p_run_id, p_shop_id, p_part_number, p_message_key, p_message_text,
    case when p_mode = 'preview' then 'preview' else 'pending' end
  )
  on conflict (message_key) do update set message_text = excluded.message_text
  returning * into v_message;

  update public.shopee_ads_report_runs
  set status = 'ready', stores_analyzed = stores_expected,
      finished_at = case when p_mode = 'preview' then now() else finished_at end
  where id = p_run_id;

  return to_jsonb(v_message) || jsonb_build_object('mode', p_mode);
end;
$$;

create or replace function public.shopee_ads_finish_delivery(
  p_message_id uuid,
  p_run_id uuid,
  p_delivery_status text,
  p_provider_message_id text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_finished_at timestamptz;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_delivery_status not in ('sent', 'failed') then raise exception 'invalid delivery status'; end if;

  update public.shopee_ads_report_messages
  set delivery_status = p_delivery_status,
      provider_message_id = nullif(p_provider_message_id, ''),
      error_message = nullif(p_error_message, ''),
      sent_at = case when p_delivery_status = 'sent' then now() else sent_at end
  where id = p_message_id and run_id = p_run_id;

  with totals as (
    select count(*) as total,
      count(*) filter (where delivery_status = 'sent') as sent,
      count(*) filter (where delivery_status = 'failed') as failed
    from public.shopee_ads_report_messages where run_id = p_run_id
  )
  update public.shopee_ads_report_runs r
  set status = case
        when totals.failed > 0 then 'partial'
        when totals.sent = totals.total then 'sent'
        else 'ready'
      end,
      finished_at = case when totals.sent + totals.failed = totals.total then now() else r.finished_at end
  from totals
  where r.id = p_run_id
  returning r.status, r.finished_at into v_status, v_finished_at;

  return jsonb_build_object('run_id', p_run_id, 'status', v_status, 'finished_at', v_finished_at);
end;
$$;

revoke all on function public.shopee_ads_begin_report(text, text, boolean) from public, anon, authenticated;
revoke all on function public.shopee_ads_queue_report(uuid) from public, anon, authenticated;
revoke all on function public.shopee_ads_report_payload(uuid) from public, anon, authenticated;
revoke all on function public.shopee_ads_save_message(uuid, bigint, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.shopee_ads_finish_delivery(uuid, uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.shopee_ads_begin_report(text, text, boolean) to service_role;
grant execute on function public.shopee_ads_queue_report(uuid) to service_role;
grant execute on function public.shopee_ads_report_payload(uuid) to service_role;
grant execute on function public.shopee_ads_save_message(uuid, bigint, integer, text, text, text) to service_role;
grant execute on function public.shopee_ads_finish_delivery(uuid, uuid, text, text, text) to service_role;
