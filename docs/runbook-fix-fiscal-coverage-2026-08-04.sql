-- Runbook 2026-08-04 — destravar a cobertura NF→pedido (estava em 6%).
-- APLICADO EM PRODUÇÃO em 04/08/2026 via 'npx supabase db query --linked'.
-- Mantido como registro e para reaplicar em outro ambiente. Idempotente.
-- Passos 1-3 = migrations 20260804180000/180100/180200 do repo.

set statement_timeout = '20min';

-- ============ PASSO 1 ============
-- O linker era insert-only (`on conflict (invoice_id) do nothing`): quando a NF
-- chegava antes do pedido ser importado, gravava um link `unmatched` que nunca
-- mais era reavaliado. Como o sync de pedidos roda atrás do de NFs, o resíduo
-- acumulava todo mês e travava a cobertura NF→pedido (agosto/2026 ficou em 6%
-- com 84% dos unmatched já tendo o pedido no banco).
--
-- Agora os candidatos incluem os links já gravados com order_id null, e o
-- upsert só promove unmatched -> matched. O guard no `where` do DO UPDATE
-- garante que um vínculo bom nunca é sobrescrito nem desfeito caso o pedido
-- suma de uma releitura.
create or replace function public.refresh_oraculo_fiscal_invoice_order_links(
  p_start_date date,
  p_end_date date
)
returns bigint
language sql
set search_path = public
as $$
  with candidates as (
    select
      invoices.id as invoice_id,
      invoices.issued_date,
      invoices.billed_revenue,
      invoices.order_number as marketplace_order_number
    from public.oraculo_fiscal_invoices_valid invoices
    left join public.oraculo_fiscal_invoice_order_links existing
      on existing.invoice_id = invoices.id
    where invoices.issued_date between p_start_date and p_end_date
      and (existing.invoice_id is null or existing.order_id is null)
  ),
  matches as (
    select
      candidates.*,
      linked.id as order_id
    from candidates
    left join lateral (
      select orders.id
      from public.olist_orders orders
      where orders.payload->'ecommerce'->>'numeroPedidoEcommerce' = candidates.marketplace_order_number
      order by orders.synced_at desc, orders.data_criacao desc nulls last, orders.id desc
      limit 1
    ) linked on true
  ),
  upserted as (
    insert into public.oraculo_fiscal_invoice_order_links (
      invoice_id,
      order_id,
      issued_date,
      billed_revenue,
      marketplace_order_number,
      link_method,
      refreshed_at
    )
    select
      matches.invoice_id,
      matches.order_id,
      matches.issued_date,
      matches.billed_revenue,
      matches.marketplace_order_number,
      case when matches.order_id is null then 'unmatched' else 'ecommerce.numeroPedidoEcommerce' end,
      now()
    from matches
    on conflict (invoice_id) do update
      set order_id = excluded.order_id,
          issued_date = excluded.issued_date,
          billed_revenue = excluded.billed_revenue,
          marketplace_order_number = excluded.marketplace_order_number,
          link_method = excluded.link_method,
          refreshed_at = excluded.refreshed_at
      where public.oraculo_fiscal_invoice_order_links.order_id is null
        and excluded.order_id is not null
    returning 1
  )
  select count(*)::bigint from upserted;
$$;

revoke all on function public.refresh_oraculo_fiscal_invoice_order_links(date, date) from public, anon, authenticated;
grant execute on function public.refresh_oraculo_fiscal_invoice_order_links(date, date) to service_role;

-- ============ PASSO 2 ============
-- O cron rodava com maxPages:1 => 100 pedidos/hora (2.400/dia) contra um volume
-- real de ~7.000-9.000 pedidos/dia reportados pela própria API da Olist. O sync
-- de NFs, por comparação, roda 800/hora. Essa defasagem fazia a NF chegar antes
-- do pedido e o linker gravar `unmatched` (ver a migration irmã
-- 20260804180000_reconcile_unmatched_invoice_order_links.sql).
--
-- Dimensionamento medido em produção (04/08, invocação real): com
-- hydrateDetails + detailDelayMs 150, 100 pedidos levam ~50s, ou seja ~0,5s por
-- pedido. O teto do timeout de 300s é portanto ~600 pedidos — 6 páginas bateria
-- exatamente no limite, sem margem. Fica em 5 páginas (500 pedidos, ~250s) e a
-- vazão vem da frequência: a cada 30 min = 1.000/h = 24.000/dia.
--
-- lookbackDays sobe de 1 para 3: com janela de 1 dia, um pedido perdido nunca
-- mais era revisitado. 3 dias dá margem de recuperação, igual ao cron de NFs.
-- A janela de 3 dias reporta ~16.500 pedidos, então 24.000/dia de capacidade
-- fecha o run com ~45% de folga (o loop para sozinho em `completed`).
do $$
begin
  perform cron.unschedule('oraculo-olist-orders-hourly');
exception
  when others then null;
end $$;

select cron.schedule(
  'oraculo-olist-orders-hourly',
  '5,35 * * * *',
  $$
    select private.invoke_oraculo_sync_function(
      'olist-sync-orders',
      '{"lookbackDays": 3, "maxPages": 5, "hydrateDetails": true, "detailDelayMs": 150}'::jsonb,
      300000
    );
  $$
);

-- ============ PASSO 3 ============
-- REGRESSÃO: 20260804140000_marketplace_fee_in_fiscal_margin.sql recriou
-- oraculo_capture_fiscal_margin_snapshots() para levar comissão ao payload, mas
-- copiou a função sem o bloco final que 20260713120000_daily_sku_coverage_snapshot.sql
-- havia acrescentado. Com isso o cron horário parou de (a) atualizar os vínculos
-- NF→pedido e (b) gravar o snapshot `sku_coverage` — que é justamente o que o
-- card de cobertura do dashboard lê no mês corrente.
--
-- Efeito observado: `sku_coverage` vinha sendo capturado 24x/dia e parou em
-- 2026-08-04 12:15, enquanto `fiscal_margin_summary` seguiu normal. O card
-- congelou no último valor e nenhuma correção de vínculo apareceria nele.
--
-- Esta migration restaura a função COM o bloco de cobertura. O corpo até
-- fiscal_channel_metrics é idêntico ao de 20260804140000; só volta o final.
create or replace function public.oraculo_capture_fiscal_margin_snapshots()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end date;
  v_summary record;
  v_skus jsonb;
  v_channels jsonb;
  v_coverage jsonb;
  v_now_sp timestamp := (now() at time zone 'America/Sao_Paulo');
begin
  v_start := date_trunc('month', v_now_sp)::date;
  v_end := (date_trunc('month', v_now_sp) + interval '1 month - 1 day')::date;

  select * into v_summary
  from public.oraculo_fiscal_margin_summary(v_start, v_end);

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_margin_summary',
    'Margem fiscal · resumo (mês corrente)',
    v_start, v_end,
    jsonb_build_object(
      'revenue_with_cost', v_summary.revenue_with_cost,
      'total_cost', v_summary.total_cost,
      'total_taxes', v_summary.total_taxes,
      'total_icms', v_summary.total_icms,
      'total_pis_cofins', v_summary.total_pis_cofins,
      'total_difal', v_summary.total_difal,
      'total_marketplace_fee', v_summary.total_marketplace_fee,
      'revenue_without_fee_params', v_summary.revenue_without_fee_params,
      'total_profit', v_summary.total_profit,
      'margin_rate', v_summary.margin_rate,
      'roi', v_summary.roi,
      'coverage_cost_revenue_pct', v_summary.coverage_cost_revenue_pct,
      'official_valid_revenue', v_summary.official_valid_revenue
    )
  );

  select coalesce(jsonb_agg(to_jsonb(s) order by s.revenue desc), '[]'::jsonb)
    into v_skus
  from public.oraculo_fiscal_sku_margin(v_start, v_end, 500) s;

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_sku_margin',
    'Margem fiscal por SKU (mês corrente)',
    v_start, v_end,
    jsonb_build_object('skus', v_skus)
  );

  select coalesce(jsonb_agg(to_jsonb(c) order by c.billed_revenue desc), '[]'::jsonb)
    into v_channels
  from public.oraculo_fiscal_channel_metrics(v_start, v_end) c;

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'fiscal_channel_metrics',
    'Receita fiscal por canal (mês corrente)',
    v_start, v_end,
    jsonb_build_object('channels', v_channels)
  );

  -- Atualiza a tabela de links (insere NFs válidas do mês ainda ausentes e,
  -- desde 20260804180000, reconcilia as que estavam gravadas como unmatched),
  -- senão o denominador da cobertura fica defasado e infla o percentual.
  perform public.refresh_oraculo_fiscal_invoice_order_links(v_start, v_end);

  -- Cobertura de item por NF (achatada: metrics + coverage + distinct_skus),
  -- para o loader existente ler direto no formato flat.
  v_coverage := public.oraculo_fiscal_order_item_backfill_progress(v_start, v_end);

  insert into public.oraculo_fiscal_snapshots (
    snapshot_key, snapshot_label, period_start, period_end, payload
  ) values (
    'sku_coverage',
    'Cobertura SKU (mês corrente)',
    v_start, v_end,
    coalesce(v_coverage -> 'metrics', '{}'::jsonb)
      || coalesce(v_coverage -> 'coverage', '{}'::jsonb)
      || jsonb_build_object('distinct_order_item_skus', coalesce(v_coverage -> 'distinct_order_item_skus', '0'::jsonb))
  );
end;
$$;

grant execute on function public.oraculo_capture_fiscal_margin_snapshots() to service_role;

-- ============ PASSO 4 — reconciliar o passivo ============
-- Com o linker corrigido, o refresh reavalia os links gravados como 'unmatched'
-- e promove a matched os que já têm pedido importado. Não é preciso DELETE.
-- Resultado real em 04/08: junho 1, julho 50.478, agosto 2.544.
select public.refresh_oraculo_fiscal_invoice_order_links('2026-06-01','2026-06-30') as junho;
select public.refresh_oraculo_fiscal_invoice_order_links('2026-07-01','2026-07-31') as julho;
select public.refresh_oraculo_fiscal_invoice_order_links('2026-08-01','2026-08-31') as agosto;

-- ============ PASSO 5 — regravar o snapshot que o card lê ============
select public.oraculo_capture_fiscal_margin_snapshots();

-- ============ PASSO 6 — conferir ============
select
  to_char(issued_date, 'YYYY-MM') as mes,
  count(*) as nfs_com_link,
  count(order_id) as com_pedido,
  round(100.0 * count(order_id) / nullif(count(*), 0), 2) as cobertura_pct
from public.oraculo_fiscal_invoice_order_links
where issued_date >= '2026-06-01'
group by 1
order by 1;

select
  snapshot_key,
  captured_at,
  payload->>'order_link_invoice_pct'  as vinculo_pct,
  payload->>'order_items_invoice_pct' as itens_pct,
  payload->>'invoices_with_matched_order' as nfs_com_pedido,
  payload->>'total_valid_invoices' as nfs_validas,
  payload->>'coverage_cost_revenue_pct' as margem_cobertura_pct
from public.oraculo_fiscal_latest_snapshots
where snapshot_key in ('sku_coverage', 'fiscal_margin_summary')
order by snapshot_key;
