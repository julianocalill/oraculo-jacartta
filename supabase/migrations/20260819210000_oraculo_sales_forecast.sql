-- Previsão de vendas da próxima semana (aba "Previsão de Vendas").
--
-- Objetivo: dar previsibilidade à logística/produção — prever unidades da
-- próxima semana (seg-dom) no total, por canal, por SKU e por dia, com regras
-- transparentes (previsão pura, sem ligação com estoque — decisão de 20/08):
--
--   base      = média simples das últimas 4 semanas completas
--   tendência = clamp( média(4 recentes) / média(4 anteriores), 0.7, 1.3 )
--   previsão  = base × tendência
--   faixa     = previsão × (1 ∓ cv), cv = clamp(desvio/média das 8 semanas, 0.05, 0.5)
--   dia       = previsão × peso do dia da semana (share por isodow em 8 semanas)
--   canal     = previsão × share do canal nas 4 semanas-base (Σ canais = total)
--   SKU       = (unidades do SKU nas k semanas-base / k) × tendência,
--               k = min(4, semanas-base desde a 1ª venda do SKU)
--
-- Média simples e não ponderada de propósito: com pouca história qualquer
-- coisa mais esperta é ajuste sem evidência e vira caixa-preta. As semanas
-- usadas saem no resultado (weeks_detail) para auditoria humana de semana
-- atípica. O clamp de ±30% na tendência evita que uma única semana de
-- campanha chicoteie a decisão de compra; o valor cru também é exposto.
--
-- PISO DO HISTÓRICO: 2026-08-03 (primeira segunda-feira >= 01/08). Antes disso
-- a hidratação de itens dos pedidos Olist é incompleta (semanas de julho com
-- ~30-70% de cobertura ⇒ unidades subcontadas até ~3x), o que contaminava a
-- base e o backtest. Decisão do Juliano em 20/08/2026: usar só de 01/08 em
-- diante e, quando alguma semana usada tiver cobertura de itens < 90%, avisar
-- em calc_note (a semana NÃO é excluída — fica avisada). O histórico útil
-- cresce sozinho a cada semana completa nova.
--
-- Fonte: oraculo_olist_qty_channel_daily_cache / oraculo_olist_qty_sku_daily_cache
-- (20260727120000/20260728120000). Só Olist — somar com Shopee duplica (a Olist
-- fatura todos os canais). B2B/"Sem canal" fica FORA da previsão (1 pedido teve
-- 213.960 unidades; ver header da 20260728120000) e a tela mostra esse volume à
-- parte via oraculo_olist_period_coverage.
--
-- Âncora: oraculo_olist_last_order_date(). O importador atrasa e reescreve dias
-- recentes, então o último dia confiável é anchor-1, e semana completa exige
-- days_present=7 no cache E week_start+6 <= anchor-1 E week_start+6 < alvo (a
-- última condição torna o backtest honesto: nunca enxerga o futuro da semana
-- prevista).
--
-- Limitação aceita: o bucket diário Olist é UTC (data_criacao::date sem
-- conversão), então o corte do dia desloca ~3h vs BRT. O viés é o mesmo em toda
-- a história, então médias e pesos por dia continuam comparáveis entre si; a
-- curva seg-dom é aproximada.
--
-- Sem cache novo: as funções são stable e leem só os caches diários (linhas
-- estreitas, nada de jsonb) — cabem folgado no statement_timeout e não criam
-- um cache que possa congelar em silêncio.

-- ---------------------------------------------------------------------------
-- Previsão canônica da semana. As demais funções consomem esta via lateral
-- para as fórmulas viverem num lugar só.
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
      -- Piso do histórico (ver header): antes de 03/08/2026 a cobertura de
      -- itens é incompleta e as unidades saem subcontadas.
      date '2026-08-03' as floor_date
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

-- ---------------------------------------------------------------------------
-- Curva dia a dia da semana prevista: peso por dia da semana calculado do
-- share de unidades por isodow nas últimas 8 semanas completas. Σ dias = total
-- por construção. Sem histórico (total 0) cai em pesos iguais (1/7).
-- ---------------------------------------------------------------------------
drop function if exists public.oraculo_sales_forecast_daily(date);

create or replace function public.oraculo_sales_forecast_daily(
  p_target_week_start date default null
)
returns table (
  day_date date,
  isodow integer,
  weight_pct numeric,
  avg_units_dow numeric,
  forecast_units numeric,
  forecast_low numeric,
  forecast_high numeric
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '15s'
as $$
  with fw as (
    select * from public.oraculo_sales_forecast_week(p_target_week_start)
  ),
  hist_weeks as (
    select (d.value ->> 'week_start')::date as week_start
    from fw, jsonb_array_elements(fw.weeks_detail) d
  ),
  daily as (
    select
      extract(isodow from c.order_date)::integer as dow,
      sum(c.units) as units,
      count(distinct date_trunc('week', c.order_date)::date) as n_weeks
    from public.oraculo_olist_qty_channel_daily_cache c
    join hist_weeks h on date_trunc('week', c.order_date)::date = h.week_start
    where c.channel_name <> 'Sem canal'
    group by 1
  ),
  weights as (
    select
      d.dow,
      case
        when sum(d.units) over () > 0 then d.units / sum(d.units) over ()
        else 1.0 / 7
      end as w,
      d.units / nullif(d.n_weeks, 0) as avg_units_dow
    from daily d
  )
  select
    fw.target_week_start + (g.dow - 1),
    g.dow,
    round(coalesce(w.w, 1.0 / 7) * 100, 2),
    round(coalesce(w.avg_units_dow, 0), 1),
    round(fw.forecast_units * coalesce(w.w, 1.0 / 7), 1),
    round(fw.forecast_low * coalesce(w.w, 1.0 / 7), 1),
    round(fw.forecast_high * coalesce(w.w, 1.0 / 7), 1)
  from fw
  cross join (select generate_series(1, 7) as dow) g
  left join weights w on w.dow = g.dow
  where fw.forecast_units is not null
  order by g.dow;
$$;

-- ---------------------------------------------------------------------------
-- Previsão por canal (top-down): share do canal nas 4 semanas-base aplicado ao
-- total previsto — garante Σ canais = total. channel_trend (razão 4v4 do
-- próprio canal, clampada) é informativa: mostra canal acelerando/freando sem
-- quebrar a soma.
-- ---------------------------------------------------------------------------
drop function if exists public.oraculo_sales_forecast_channels(date);

create or replace function public.oraculo_sales_forecast_channels(
  p_target_week_start date default null
)
returns table (
  channel_name text,
  units_base numeric,
  avg_units_week numeric,
  share_pct numeric,
  channel_trend numeric,
  forecast_units numeric,
  forecast_low numeric,
  forecast_high numeric
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '15s'
as $$
  with fw as (
    select * from public.oraculo_sales_forecast_week(p_target_week_start)
  ),
  hist_weeks as (
    select
      (d.value ->> 'week_start')::date as week_start,
      (d.value ->> 'is_base')::boolean as is_base
    from fw, jsonb_array_elements(fw.weeks_detail) d
  ),
  by_channel as (
    select
      c.channel_name as source_name,
      sum(c.units) filter (where h.is_base) as units_base,
      count(distinct h.week_start) filter (where h.is_base) as n_base,
      sum(c.units) filter (where not h.is_base) as units_prev,
      count(distinct h.week_start) filter (where not h.is_base) as n_prev
    from public.oraculo_olist_qty_channel_daily_cache c
    join hist_weeks h on date_trunc('week', c.order_date)::date = h.week_start
    where c.channel_name <> 'Sem canal'
    group by 1
  ),
  shares as (
    select
      b.*,
      b.units_base / nullif(sum(b.units_base) over (), 0) as share,
      case
        when b.n_prev >= 2 and coalesce(b.units_prev, 0) > 0 and b.n_base > 0
          then least(greatest(
            (b.units_base / b.n_base) / (b.units_prev / b.n_prev), 0.7), 1.3)
      end as ch_trend
    from by_channel b
    where coalesce(b.units_base, 0) > 0
  )
  select
    coalesce(max(d.display_name), s.source_name),
    round(s.units_base, 0),
    round(s.units_base / nullif(s.n_base, 0), 1),
    round(s.share * 100, 2),
    round(s.ch_trend, 4),
    round(fw.forecast_units * s.share, 1),
    round(fw.forecast_low * s.share, 1),
    round(fw.forecast_high * s.share, 1)
  from shares s
  cross join fw
  left join public.dim_channels d
    on d.source = 'olist' and d.source_name = s.source_name
  where fw.forecast_units is not null
  group by s.source_name, s.units_base, s.n_base, s.share, s.ch_trend,
           fw.forecast_units, fw.forecast_low, fw.forecast_high
  order by s.units_base desc;
$$;

-- ---------------------------------------------------------------------------
-- Previsão por SKU (previsão pura, para a logística planejar produção — sem
-- ligação com estoque; decisão de 20/08: estoque/cobertura é assunto da Curva
-- de Estoque). k = min(4, semanas-base desde a 1ª venda) trata SKU novo sem
-- penalizar a média; is_new sinaliza baixa confiança. SKU sem venda nas
-- semanas-base fica fora (previsão 0).
--
-- Limitação: o cache de SKU só tem o boolean has_channel, não o nome do canal
-- — esta tabela é total-marketplaces, sem filtro por canal (v2: dimensão de
-- canal no cache).
-- ---------------------------------------------------------------------------
drop function if exists public.oraculo_sales_forecast_skus(date);

create or replace function public.oraculo_sales_forecast_skus(
  p_target_week_start date default null
)
returns table (
  sku text,
  product_name text,
  weeks_with_sales integer,
  weeks_considered integer,
  is_new boolean,
  units_base numeric,
  avg_units_week numeric,
  forecast_units numeric,
  forecast_low numeric,
  forecast_high numeric
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '30s'
as $$
  with fw as (
    select * from public.oraculo_sales_forecast_week(p_target_week_start)
  ),
  base_weeks as (
    select (d.value ->> 'week_start')::date as week_start
    from fw, jsonb_array_elements(fw.weeks_detail) d
    where (d.value ->> 'is_base')::boolean
  ),
  first_sale as (
    select c.sku, min(c.order_date) as first_sale_date
    from public.oraculo_olist_qty_sku_daily_cache c
    where c.has_channel
    group by 1
  ),
  by_sku as (
    select
      c.sku,
      max(c.product_name) as product_name,
      sum(c.units) as units_base,
      count(distinct b.week_start) filter (where c.units > 0) as weeks_with_sales
    from public.oraculo_olist_qty_sku_daily_cache c
    join base_weeks b on date_trunc('week', c.order_date)::date = b.week_start
    where c.has_channel
    group by 1
    having sum(c.units) > 0
  ),
  calc as (
    select
      s.sku,
      s.product_name,
      s.weeks_with_sales::integer,
      greatest(least(
        (select count(*) from base_weeks b where b.week_start + 6 >= f.first_sale_date),
        (select count(*) from base_weeks)
      ), 1)::integer as weeks_considered,
      f.first_sale_date > (select min(week_start) from base_weeks) as is_new,
      s.units_base
    from by_sku s
    join first_sale f on f.sku = s.sku
  )
  select
    c.sku,
    c.product_name,
    c.weeks_with_sales,
    c.weeks_considered,
    c.is_new,
    round(c.units_base, 0),
    round(c.units_base / c.weeks_considered, 2) as avg_units_week,
    round(c.units_base / c.weeks_considered * fw.trend, 2) as forecast_units,
    round(c.units_base / c.weeks_considered * fw.trend * (1 - fw.cv), 2) as forecast_low,
    round(c.units_base / c.weeks_considered * fw.trend * (1 + fw.cv), 2) as forecast_high
  from calc c
  cross join fw
  where fw.forecast_units is not null
  order by forecast_units desc, c.sku;
$$;

-- ---------------------------------------------------------------------------
-- Backtest: para cada uma das últimas p_weeks semanas completas, calcula a
-- previsão "como se fosse na época" (a função canônica nunca enxerga dados
-- >= semana-alvo) e compara com o realizado. É a prova de honestidade do
-- método e alimenta o painel de acurácia da tela.
-- ---------------------------------------------------------------------------
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
      count(distinct c.order_date) as days_present
    from public.oraculo_olist_qty_channel_daily_cache c
    where c.channel_name <> 'Sem canal'
      -- Mesmo piso da função canônica: antes disso o "realizado" está
      -- subcontado e o erro do backtest vira artefato de cobertura.
      and c.order_date >= date '2026-08-03'
    group by 1
  ),
  target_weeks as (
    select w.week_start, w.realized_units
    from weeks w, anchor a
    where w.days_present = 7
      and w.week_start + 6 <= a.anchor - 1
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

-- Mesmo padrão dos demais RPCs de leitura: security definer + search_path fixo
-- + grant para authenticated, para a página e o export lerem pelo client do
-- usuário sem expor as tabelas base.
revoke all on function public.oraculo_sales_forecast_week(date) from public, anon;
revoke all on function public.oraculo_sales_forecast_daily(date) from public, anon;
revoke all on function public.oraculo_sales_forecast_channels(date) from public, anon;
revoke all on function public.oraculo_sales_forecast_skus(date) from public, anon;
revoke all on function public.oraculo_sales_forecast_backtest(integer) from public, anon;

grant execute on function public.oraculo_sales_forecast_week(date) to authenticated, service_role;
grant execute on function public.oraculo_sales_forecast_daily(date) to authenticated, service_role;
grant execute on function public.oraculo_sales_forecast_channels(date) to authenticated, service_role;
grant execute on function public.oraculo_sales_forecast_skus(date) to authenticated, service_role;
grant execute on function public.oraculo_sales_forecast_backtest(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill único dos qty caches: eles só têm história desde ~06/07/2026
-- (populate inicial de 21 dias na 20260727120000) e o cron horário só reescreve
-- 10 dias. A previsão precisa de até 8 semanas completas antes da semana-alvo
-- (e o backtest, de mais), então reprocessa 120 dias — de quebra recomputa
-- dias que congelaram com cobertura de itens incompleta. (O backfill revelou
-- que a cobertura pré-agosto é irrecuperável sem re-hidratar os pedidos Olist;
-- daí o piso de 03/08 nas funções acima.)
--
-- Vai por job one-shot de pg_cron porque a função leva ~6-8 min em 120 dias
-- (detoast do payload de 957 MB) e não passa pelo gateway da Management API
-- (timeout de 2 min). Minuto :02 — só o bip (*/2) usa, fica dentro do teto de
-- 2 jobs/minuto (ver 20260805190000). O unschedule no fim do comando desagenda
-- o job após o primeiro sucesso; se falhar, tenta de novo na próxima hora.
select cron.schedule(
  'oraculo-qty-cache-backfill-once',
  '2 * * * *',
  $$
    set local statement_timeout = '20min';
    select public.refresh_oraculo_olist_qty_cache(120);
    select cron.unschedule('oraculo-qty-cache-backfill-once');
  $$
);
