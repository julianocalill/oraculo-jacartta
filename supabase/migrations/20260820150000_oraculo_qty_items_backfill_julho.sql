-- Backfill de itens dos pedidos de 20/07–02/08 para a Previsão de Vendas.
--
-- Contexto (20/08/2026): a base da previsão tem só 2 semanas íntegras porque
-- as semanas de 20/07 e 27/07 estão com ~30% de cobertura de itens — 45,5 mil
-- pedidos da janela não têm linha em olist_order_items e nenhum deles tem
-- payload.itens (todos precisam de GET pedidos/{id} na API Olist). O Juliano
-- pediu para "alimentar" essas semanas e ter 4 semanas de base.
--
-- Mecânica reaproveitada: a fila olist_order_item_backfill_queue + a edge
-- function olist-backfill-order-items (que já trata token, 429 e marca a
-- fila). O que muda:
--
-- 1. A fila passa a aceitar pedido SEM nota fiscal (invoice_id/issued_at
--    nullable): a semeadura fiscal (prepare_olist_order_item_backfill_queue)
--    só cobre 66% dos pedidos sem itens da janela — insuficiente para os 90%
--    de cobertura que a previsão exige.
-- 2. Nova semeadura por pedido (prepare_olist_order_item_backfill_queue_by_orders):
--    todo pedido não-cancelado da janela sem linha em olist_order_items,
--    mesmo critério de cancelamento do qty cache (dim_status/situacao='8').
-- 3. Cron driver a cada 2 min (invoke assíncrono via pg_net; maxRuntimeMs
--    100s garante que não há duas execuções simultâneas disputando os mesmos
--    candidatos — a RPC de candidatos não usa SKIP LOCKED). Throughput ~100
--    pedidos/2min ⇒ ~45,5 mil em ~15-16h.
-- 4. Cron finalizador horário (minuto :14): quando a fila da janela zerar,
--    roda refresh_oraculo_olist_qty_cache(35) (reescreve as semanas de julho
--    no cache) e desagenda o driver e a si mesmo. Autônomo de ponta a ponta.
-- 5. O piso da previsão desce de 03/08 para 20/07, mas semana anterior a
--    03/08 só entra quando a cobertura de itens dela for >= 90% — ou seja, as
--    semanas de julho passam a contar sozinhas assim que o backfill + refresh
--    terminarem, sem degradar a previsão enquanto isso. De 03/08 em diante
--    vale a regra decidida em 20/08: semana entra sempre e cobertura < 90%
--    gera aviso em calc_note.

-- ---------------------------------------------------------------------------
-- 1. Fila aceita pedido sem NF
-- ---------------------------------------------------------------------------
alter table public.olist_order_item_backfill_queue
  alter column invoice_id drop not null,
  alter column issued_at drop not null;

-- ---------------------------------------------------------------------------
-- 2. Semeadura por pedido (independente de NF)
-- ---------------------------------------------------------------------------
create or replace function public.prepare_olist_order_item_backfill_queue_by_orders(
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reconciled bigint := 0;
  v_inserted bigint := 0;
  v_pending bigint := 0;
  v_total bigint := 0;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'Invalid backfill queue period: % to %', p_start_date, p_end_date;
  end if;

  -- Pedidos que ganharam itens por outro caminho saem da fila.
  update public.olist_order_item_backfill_queue queue
  set
    status = 'completed',
    processed_at = coalesce(queue.processed_at, now()),
    last_error = null,
    updated_at = now()
  where queue.window_start = p_start_date
    and queue.window_end = p_end_date
    and queue.processed_at is null
    and exists (
      select 1 from public.olist_order_items items
      where items.order_id = queue.order_id
    );
  get diagnostics v_reconciled = row_count;

  -- Mesmo critério de pedido válido do qty cache (20260727120000):
  -- cancelado = dim_order_status.is_canceled, fallback situacao = '8'.
  insert into public.olist_order_item_backfill_queue (
    window_start, window_end, invoice_id, invoice_number,
    order_id, order_number, issued_at, total_amount
  )
  select
    p_start_date,
    p_end_date,
    null,
    null,
    o.id,
    o.numero_pedido,
    o.data_criacao,
    0
  from public.olist_orders o
  left join public.dim_order_status s
    on s.source = 'olist' and s.code = o.situacao
  where o.data_criacao::date between p_start_date and p_end_date
    and not coalesce(s.is_canceled, o.situacao = '8', false)
    and not exists (
      select 1 from public.olist_order_items items
      where items.order_id = o.id
    )
  on conflict (window_start, window_end, order_id) do nothing;
  get diagnostics v_inserted = row_count;

  select
    count(*) filter (where processed_at is null and status = 'pending'),
    count(*)
  into v_pending, v_total
  from public.olist_order_item_backfill_queue
  where window_start = p_start_date
    and window_end = p_end_date;

  return jsonb_build_object(
    'window_start', p_start_date,
    'window_end', p_end_date,
    'reconciled_existing_items', v_reconciled,
    'inserted', v_inserted,
    'pending', v_pending,
    'total', v_total
  );
end;
$$;

revoke all on function public.prepare_olist_order_item_backfill_queue_by_orders(date, date) from public, anon, authenticated;
grant execute on function public.prepare_olist_order_item_backfill_queue_by_orders(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Piso da previsão: 20/07, com trava de cobertura antes de 03/08
--    (substitui as definições da 20260819210000; demais funções não mudam —
--    daily/channels/skus derivam de weeks_detail e seguem automaticamente)
-- ---------------------------------------------------------------------------
drop function if exists public.oraculo_sales_forecast_week(date);

create or replace function public.oraculo_sales_forecast_week(
  p_target_week_start date default null
)
returns table (
  target_week_start date,
  anchor_date date,
  last_complete_week date,
  n_base integer,
  n_prev integer,
  base_avg_units numeric,
  prev_avg_units numeric,
  trend_raw numeric,
  trend numeric,
  cv numeric,
  forecast_units numeric,
  forecast_low numeric,
  forecast_high numeric,
  weeks_detail jsonb,
  calc_note text
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '15s'
as $$
  with params as (
    select
      coalesce(
        date_trunc('week', p_target_week_start)::date,
        date_trunc('week', current_date)::date + 7
      ) as target,
      public.oraculo_olist_last_order_date() as anchor,
      -- Piso absoluto do histórico: antes de 20/07 a cobertura de itens é
      -- irrecuperável sem re-hidratar (e não há backfill agendado).
      date '2026-07-20' as floor_date,
      -- A partir daqui a semana entra sempre (cobertura < 90% gera aviso);
      -- entre floor_date e aqui, a semana só entra com cobertura >= 90% —
      -- as semanas de julho passam a contar quando o backfill de itens
      -- (20260820150000) terminar e o cache for reescrito.
      date '2026-08-03' as trusted_from
  ),
  weekly as (
    select
      date_trunc('week', c.order_date)::date as week_start,
      sum(c.units) as units,
      sum(c.orders_valid) as orders_valid,
      sum(c.orders_with_items) as orders_with_items,
      count(distinct c.order_date) as days_present
    from public.oraculo_olist_qty_channel_daily_cache c, params p
    where c.channel_name <> 'Sem canal'
      and c.order_date >= p.floor_date
      and c.order_date < p.target
    group by 1
  ),
  ranked as (
    select w.*, row_number() over (order by w.week_start desc) as rn
    from weekly w, params p
    where w.days_present = 7
      and w.week_start + 6 <= p.anchor - 1
      and w.week_start + 6 < p.target
      and (
        w.week_start >= p.trusted_from
        or w.orders_with_items * 100.0 >= 90 * nullif(w.orders_valid, 0)
      )
  ),
  calc as (
    select
      count(*) filter (where rn <= 4)::integer as n_base,
      count(*) filter (where rn between 5 and 8)::integer as n_prev,
      avg(units) filter (where rn <= 4) as base_avg,
      avg(units) filter (where rn between 5 and 8) as prev_avg,
      stddev_samp(units) filter (where rn <= 8)
        / nullif(avg(units) filter (where rn <= 8), 0) as raw_cv,
      count(*) filter (
        where rn <= 8
          and orders_with_items * 100.0 / nullif(orders_valid, 0) < 90
      )::integer as n_low_coverage,
      max(week_start) as last_complete_week
    from ranked
  ),
  factors as (
    select
      c.*,
      case
        when c.prev_avg is null or c.prev_avg <= 0 or c.n_prev < 2 then null
        else c.base_avg / c.prev_avg
      end as trend_raw
    from calc c
  ),
  final as (
    select
      f.*,
      case
        when f.trend_raw is null then 1
        else least(greatest(f.trend_raw, 0.7), 1.3)
      end as trend,
      least(greatest(coalesce(f.raw_cv, 0.15), 0.05), 0.5) as cv
    from factors f
  )
  select
    p.target,
    p.anchor,
    f.last_complete_week,
    f.n_base,
    f.n_prev,
    round(f.base_avg, 1),
    round(f.prev_avg, 1),
    round(f.trend_raw, 4),
    round(f.trend, 4),
    round(f.cv, 4),
    case when f.n_base >= 2 then round(f.base_avg * f.trend) end,
    case when f.n_base >= 2 then round(f.base_avg * f.trend * (1 - f.cv)) end,
    case when f.n_base >= 2 then round(f.base_avg * f.trend * (1 + f.cv)) end,
    (
      select jsonb_agg(jsonb_build_object(
        'week_start', r.week_start,
        'units', r.units,
        'orders', r.orders_valid,
        'items_coverage_pct',
          round(r.orders_with_items * 100.0 / nullif(r.orders_valid, 0), 1),
        'is_base', r.rn <= 4
      ) order by r.week_start)
      from ranked r
      where r.rn <= 8
    ),
    nullif(concat_ws('; ',
      case
        when f.n_base < 2 then 'histórico insuficiente: menos de 2 semanas completas antes da semana-alvo'
        when f.n_prev < 2 then 'sem 4 semanas anteriores para tendência; usando tendência = 1'
      end,
      case
        when f.n_low_coverage > 0 then
          f.n_low_coverage || ' semana(s) usada(s) com cobertura de itens abaixo de 90% — unidades subcontadas nelas'
      end
    ), '')
  from params p, final f;
$$;

drop function if exists public.oraculo_sales_forecast_backtest(integer);

create or replace function public.oraculo_sales_forecast_backtest(
  p_weeks integer default 4
)
returns table (
  week_start date,
  forecast_units numeric,
  forecast_low numeric,
  forecast_high numeric,
  realized_units numeric,
  error_pct numeric,
  within_range boolean
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '45s'
as $$
  with anchor as (
    select public.oraculo_olist_last_order_date() as anchor
  ),
  weeks as (
    select
      date_trunc('week', c.order_date)::date as week_start,
      sum(c.units) as realized_units,
      sum(c.orders_valid) as orders_valid,
      sum(c.orders_with_items) as orders_with_items,
      count(distinct c.order_date) as days_present
    from public.oraculo_olist_qty_channel_daily_cache c
    where c.channel_name <> 'Sem canal'
      -- Mesmas regras da função canônica: piso 20/07 e, antes de 03/08, só
      -- semana com cobertura >= 90% (senão o "realizado" está subcontado e o
      -- erro do backtest vira artefato de cobertura).
      and c.order_date >= date '2026-07-20'
    group by 1
  ),
  target_weeks as (
    select w.week_start, w.realized_units
    from weeks w, anchor a
    where w.days_present = 7
      and w.week_start + 6 <= a.anchor - 1
      and (
        w.week_start >= date '2026-08-03'
        or w.orders_with_items * 100.0 >= 90 * nullif(w.orders_valid, 0)
      )
    order by w.week_start desc
    limit greatest(p_weeks, 1)
  )
  select
    t.week_start,
    f.forecast_units,
    f.forecast_low,
    f.forecast_high,
    round(t.realized_units, 0),
    round((f.forecast_units - t.realized_units) * 100.0 / nullif(t.realized_units, 0), 1),
    t.realized_units between f.forecast_low and f.forecast_high
  from target_weeks t
  cross join lateral public.oraculo_sales_forecast_week(t.week_start) f
  where f.forecast_units is not null
  order by t.week_start;
$$;

revoke all on function public.oraculo_sales_forecast_week(date) from public, anon;
revoke all on function public.oraculo_sales_forecast_backtest(integer) from public, anon;
grant execute on function public.oraculo_sales_forecast_week(date) to authenticated, service_role;
grant execute on function public.oraculo_sales_forecast_backtest(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Cron driver: processa a fila da janela a cada 2 min.
--    invoke é net.http_post (assíncrono) — o worker do pg_cron é liberado na
--    hora; maxRuntimeMs 100s < cadência de 120s ⇒ sem execuções simultâneas.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'oraculo-olist-items-backfill-julho',
  '*/2 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-backfill-order-items',
      jsonb_build_object(
        'startDate', '2026-07-20',
        'endDate',   '2026-08-02',
        'limit',        100,
        'delayMs',      250,
        'maxRuntimeMs', 100000
      ),
      120000
    );
  $$
);

-- ---------------------------------------------------------------------------
-- 5. Finalizador horário: fila zerou -> reescreve o cache das semanas de
--    julho e desagenda tudo (inclusive a si mesmo). Minuto :14 está livre no
--    mapa de crons. Linhas 'error'/'no_items' não bloqueiam (só 'pending').
-- ---------------------------------------------------------------------------
select cron.schedule(
  'oraculo-olist-items-backfill-julho-finish',
  '14 * * * *',
  $$
    do $fin$
    begin
      if not exists (
        select 1
        from public.olist_order_item_backfill_queue
        where window_start = date '2026-07-20'
          and window_end = date '2026-08-02'
          and processed_at is null
          and status = 'pending'
      ) then
        set local statement_timeout = '20min';
        perform public.refresh_oraculo_olist_qty_cache(35);
        perform cron.unschedule('oraculo-olist-items-backfill-julho');
        perform cron.unschedule('oraculo-olist-items-backfill-julho-finish');
      end if;
    end
    $fin$;
  $$
);
