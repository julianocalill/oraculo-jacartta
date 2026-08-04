-- Comissão de marketplace na margem fiscal.
--
-- Até aqui a margem fiscal era puramente tributária (receita − custo − impostos):
-- comissão, frete, ads e embalagem ficavam de fora, então o número exibido era
-- sempre maior que a margem real. Decisão do negócio (04/08/2026): tratar frete,
-- ads, embalagem e despesa operacional como **já embutidos no desconto do
-- marketplace**, usando as mesmas faixas (% + fixo) da calculadora — em vez de
-- criar uma linha própria para cada custo.
--
-- Fonte da faixa: `oraculo_marketplace_fee_params` (dado, não código), casada com
-- `olist_invoices.fiscal_channel_label` por ILIKE. Canal sem faixa cadastrada não
-- inventa comissão: fica com fee 0 e `fee_missing = true`, e o resumo reporta
-- quanta receita está nessa situação.
--
--   faixa       = primeira cujo `max` cobre o PREÇO UNITÁRIO do item (max null = aberta)
--   comissão    = receita × rate/100 + fixed × quantidade
--   lucro       = receita − custo − ICMS − PIS/COFINS − DIFAL − comissão
--
-- O fixo multiplica a quantidade porque em ML/TikTok/Shopee ele é cobrado por
-- unidade vendida, e por isso a faixa também é escolhida pelo preço unitário
-- (os degraus de R$ 28,99 / 49,99 / 78,99 do ML são limites por unidade).

create table if not exists public.oraculo_marketplace_fee_params (
  marketplace_key text primary key,
  display_name text not null,
  match_pattern text not null,
  match_priority integer not null default 100,
  tiers jsonb not null default '[]'::jsonb,
  fee_configured boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);

comment on table public.oraculo_marketplace_fee_params is
  'Faixas de comissão por marketplace (% + fixo por unidade). Absorvem frete, ads, embalagem e despesa operacional. Casadas com olist_invoices.fiscal_channel_label via ILIKE match_pattern, menor match_priority vence.';

alter table public.oraculo_marketplace_fee_params enable row level security;

insert into public.oraculo_marketplace_fee_params
  (marketplace_key, display_name, match_pattern, match_priority, tiers, fee_configured, notes)
values
  ('shopee', 'Shopee', 'Shopee%', 10, '[
      {"max": 79.99,  "rate": 20, "fixed": 4},
      {"max": 99.99,  "rate": 14, "fixed": 16},
      {"max": 199.99, "rate": 14, "fixed": 20},
      {"max": 499.99, "rate": 14, "fixed": 26},
      {"max": null,   "rate": 14, "fixed": 28}
    ]'::jsonb, true,
   'Faixas originais da calculadora. Cobrem comissão + frete + ads + embalagem.'),

  ('mercado_livre', 'Mercado Livre', 'Mercado Livre%', 10, '[
      {"max": 28.99, "rate": 13, "fixed": 6.25},
      {"max": 49.99, "rate": 13, "fixed": 6.5},
      {"max": 78.99, "rate": 13, "fixed": 6.75},
      {"max": null,  "rate": 13, "fixed": 0}
    ]'::jsonb, true,
   'ML Clássico (comissão 10-14% por categoria, padrão 13%) + custo fixo por unidade até R$ 78,99. Confirmado pelo negócio em 04/08/2026: os anúncios são Clássico, não Premium.'),

  ('tiktok', 'TikTok Shop', 'TikTok%', 10, '[
      {"max": 78.99, "rate": 6, "fixed": 4},
      {"max": null,  "rate": 6, "fixed": 0}
    ]'::jsonb, true,
   'Comissão 5-8% por categoria (padrão 6%) + R$ 4,00 fixo por item até R$ 78,99 (vigente fev/2026). Programa de frete SFP não incluído.'),

  ('amazon', 'Amazon', 'Amazon%', 10, '[
      {"max": null, "rate": 15, "fixed": 0}
    ]'::jsonb, true,
   'Comissão por categoria 8-15%; Casa/cozinha/móveis fica em 12-15% — adotado o topo (15%) por conservadorismo. Sem taxa por item: ela só existe no plano Individual (R$ 2/item), e a operação usa o Profissional (R$ 19/mês, custo fixo fora da linha). Fonte: Amazon Seller Central BR via gosmarter.com.br e sellsync.ai, consultado em 04/08/2026.'),

  ('shein', 'Shein', 'Shein%', 10, '[
      {"max": null, "rate": 18, "fixed": 0}
    ]'::jsonb, true,
   'Comissão única de 18% sobre o preço final (com descontos/cupons de loja), sem taxa fixa. Subiu de 16% para 18% em pedidos criados a partir de 01/03/2026. Fonte: política oficial SHEIN Brasil (br.shein.com/SHEIN-Commission-Policy-a-1420.html), consultada em 04/08/2026.'),

  ('kwai', 'Kwai Shop', 'Kwai%', 10, '[
      {"max": null, "rate": 20, "fixed": 4}
    ]'::jsonb, true,
   'Comissão padrão de 20% + R$ 4,00 fixo por item. Os 14% dos primeiros 45 dias valem só para seller novo, não se aplica. O Kwai não desconta frete do vendedor. A plataforma não publica tabela oficial detalhada — confirmar no painel do seller. Fonte: ecommercenapratica.com/blog/como-vender-no-kwai, consultado em 04/08/2026.'),

  ('sem_faixa', 'Canal sem faixa cadastrada', '%', 999, '[
      {"max": null, "rate": 0, "fixed": 0}
    ]'::jsonb, false,
   'Fallback para vendas sem canal identificado e canais novos ainda não parametrizados. Comissão 0 e fee_missing = true: o lucro dessas linhas fica superestimado e a receita é reportada em revenue_without_fee_params.')
on conflict (marketplace_key) do update set
  display_name = excluded.display_name,
  match_pattern = excluded.match_pattern,
  match_priority = excluded.match_priority,
  tiers = excluded.tiers,
  fee_configured = excluded.fee_configured,
  notes = excluded.notes,
  updated_at = now();

drop policy if exists oraculo_marketplace_fee_params_read on public.oraculo_marketplace_fee_params;
create policy oraculo_marketplace_fee_params_read
  on public.oraculo_marketplace_fee_params
  for select to authenticated
  using (true);

grant select on public.oraculo_marketplace_fee_params to authenticated;
grant select, insert, update, delete on public.oraculo_marketplace_fee_params to service_role;

-- ---------------------------------------------------------------------------

drop function if exists public.oraculo_fiscal_margin_summary(date, date);
drop function if exists public.oraculo_fiscal_sku_margin(date, date, integer);
drop function if exists public.oraculo_fiscal_margin_lines(date, date);

create or replace function public.oraculo_fiscal_margin_lines(p_start date, p_end date)
returns table (
  invoice_id text,
  uf text,
  channel_label text,
  marketplace_key text,
  sku text,
  produto_id text,
  origin text,
  quantity numeric,
  revenue numeric,
  cost numeric,
  cost_missing boolean,
  icms numeric,
  pis_cofins numeric,
  difal numeric,
  taxes_total numeric,
  marketplace_fee numeric,
  fee_missing boolean,
  profit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with internal_icms(uf, rate) as (
    values ('AC',19),('AL',20),('AP',18),('AM',20),('BA',20.5),('CE',20),('DF',20),
           ('ES',17),('GO',19),('MA',22),('MT',17),('MS',17),('MG',18),('PA',19),
           ('PB',20),('PR',19.5),('PE',20.5),('PI',21),('RJ',22),('RN',20),('RS',17),
           ('RO',19.5),('RR',20),('SC',17),('SP',18),('SE',19),('TO',20)
  ),
  -- Faixas achatadas: uma linha por degrau, já com a prioridade do marketplace.
  fee_tiers as (
    select
      p.marketplace_key,
      p.match_pattern,
      p.match_priority,
      p.fee_configured,
      x.ord,
      case when x.tier->>'max' is null then null else (x.tier->>'max')::numeric end as max_price,
      coalesce((x.tier->>'rate')::numeric, 0) as rate,
      coalesce((x.tier->>'fixed')::numeric, 0) as fixed
    from oraculo_marketplace_fee_params p
    cross join lateral jsonb_array_elements(p.tiers) with ordinality as x(tier, ord)
  ),
  raw as (
    select
      l.invoice_id,
      upper(coalesce(inv.uf, '')) as uf,
      coalesce(inv.fiscal_channel_label, 'Sem canal') as channel_label,
      oi.sku,
      oi.produto_id,
      case when (p.payload->>'origem') = '1' then 'importado' else 'nacional' end as origin,
      coalesce(oi.quantidade, 0)::numeric as quantity,
      coalesce(oi.valor_total, 0)::numeric as revenue,
      coalesce(ec.unit_cost, 0)::numeric as raw_unit_cost,
      coalesce(ec.cost_complete, false) as cost_complete,
      case when coalesce(oi.quantidade,0) > 0 then coalesce(oi.valor_total,0) / oi.quantidade else null end as unit_price
    from oraculo_fiscal_invoice_order_links l
    join olist_invoices inv on inv.id = l.invoice_id
    join olist_order_items oi on oi.order_id = l.order_id
    left join olist_products p on p.id = oi.produto_id
    left join oraculo_product_effective_cost ec on ec.product_id = oi.produto_id
    where l.issued_date between p_start and p_end
      and l.order_id is not null
  ),
  base as (
    -- Custo indisponível quando: custo <= 0, kit sem custo completo dos
    -- componentes, ou custo implausível (> 3x o preço de venda REAL do item).
    select
      invoice_id, uf, channel_label, sku, produto_id, origin, quantity, revenue, unit_price,
      case
        when raw_unit_cost <= 0 then null
        when not cost_complete then null
        when unit_price is not null and raw_unit_cost > unit_price * 3 then null
        else quantity * raw_unit_cost
      end as cost,
      (
        raw_unit_cost <= 0
        or not cost_complete
        or (unit_price is not null and raw_unit_cost > unit_price * 3)
      ) as cost_missing
    from raw
  ),
  calc as (
    select
      b.*,
      -- ICMS de saída (matriz Jacarta), sobre a receita
      b.revenue * (case
        when b.uf = 'MG' then (case when b.origin = 'importado' then 14 else 6 end)
        else 1.3 end) / 100.0 as icms,
      -- PIS/COFINS 9,25% líquido de crédito sobre o custo (null se custo indisponível)
      case when b.cost is null then null
           else greatest(0, b.revenue * 0.0925 - b.cost * 0.0925) end as pis_cofins,
      -- DIFAL = base * max(0, interna_destino - interestadual)
      b.revenue * greatest(0,
        coalesce(ii.rate, 0)
        - (case when b.origin = 'importado' then 4
                when b.uf in ('MG','PR','RJ','RS','SC','SP') then 12
                else 7 end)
      ) / 100.0 as difal,
      -- Comissão do marketplace: faixa pelo preço unitário, fixo por unidade.
      -- Absorve frete, ads, embalagem e despesa operacional.
      fee.marketplace_key,
      not coalesce(fee.fee_configured, false) as fee_missing,
      case when fee.fee_configured then
        b.revenue * coalesce(fee.rate, 0) / 100.0 + coalesce(fee.fixed, 0) * b.quantity
      else 0 end as marketplace_fee
    from base b
    left join internal_icms ii on ii.uf = b.uf
    left join lateral (
      select ft.marketplace_key, ft.rate, ft.fixed, ft.fee_configured
      from fee_tiers ft
      where b.channel_label ilike ft.match_pattern
        and (ft.max_price is null or coalesce(b.unit_price, b.revenue) <= ft.max_price)
      order by ft.match_priority, ft.ord
      limit 1
    ) fee on true
  )
  select
    invoice_id, uf, channel_label, marketplace_key, sku, produto_id, origin,
    quantity, revenue, cost, cost_missing,
    icms, pis_cofins, difal,
    case when cost is null then null else icms + pis_cofins + difal end as taxes_total,
    marketplace_fee, fee_missing,
    case when cost is null then null
         else revenue - cost - icms - pis_cofins - difal - marketplace_fee end as profit
  from calc;
$$;

-- Agregado por SKU no período (para /skus).
create or replace function public.oraculo_fiscal_sku_margin(p_start date, p_end date, p_limit integer default 200)
returns table (
  sku text,
  units numeric,
  revenue numeric,
  cost numeric,
  icms numeric,
  pis_cofins numeric,
  difal numeric,
  taxes_total numeric,
  marketplace_fee numeric,
  profit numeric,
  margin_rate numeric,
  roi numeric,
  cost_missing_lines bigint,
  fee_missing_lines bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sku,
    sum(quantity) as units,
    sum(revenue) as revenue,
    sum(cost) as cost,
    sum(icms) as icms,
    sum(pis_cofins) as pis_cofins,
    sum(difal) as difal,
    sum(taxes_total) as taxes_total,
    sum(marketplace_fee) as marketplace_fee,
    sum(profit) as profit,
    case when sum(revenue) > 0 then sum(profit) / sum(revenue) else null end as margin_rate,
    case when sum(cost) > 0 then sum(profit) / sum(cost) else null end as roi,
    count(*) filter (where cost_missing) as cost_missing_lines,
    count(*) filter (where fee_missing) as fee_missing_lines
  from public.oraculo_fiscal_margin_lines(p_start, p_end)
  where cost is not null
  group by sku
  order by revenue desc
  limit greatest(1, coalesce(p_limit, 200));
$$;

-- Resumo do período + cobertura (para o dashboard).
create or replace function public.oraculo_fiscal_margin_summary(p_start date, p_end date)
returns table (
  invoices_with_item bigint,
  revenue_with_item numeric,
  invoices_with_cost bigint,
  revenue_with_cost numeric,
  total_cost numeric,
  total_icms numeric,
  total_pis_cofins numeric,
  total_difal numeric,
  total_taxes numeric,
  total_marketplace_fee numeric,
  revenue_without_fee_params numeric,
  total_profit numeric,
  margin_rate numeric,
  roi numeric,
  official_valid_invoices bigint,
  official_valid_revenue numeric,
  coverage_item_revenue_pct numeric,
  coverage_cost_revenue_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select * from public.oraculo_fiscal_margin_lines(p_start, p_end)
  ),
  agg as (
    select
      count(distinct invoice_id) as invoices_with_item,
      sum(revenue) as revenue_with_item,
      count(distinct invoice_id) filter (where cost is not null) as invoices_with_cost,
      sum(revenue) filter (where cost is not null) as revenue_with_cost,
      sum(cost) as total_cost,
      sum(icms) filter (where cost is not null) as total_icms,
      sum(pis_cofins) as total_pis_cofins,
      sum(difal) filter (where cost is not null) as total_difal,
      sum(taxes_total) as total_taxes,
      sum(marketplace_fee) filter (where cost is not null) as total_marketplace_fee,
      sum(revenue) filter (where cost is not null and fee_missing) as revenue_without_fee_params,
      sum(profit) as total_profit
    from lines
  ),
  official as (
    select count(*) as inv, coalesce(sum(billed_revenue),0) as rev
    from oraculo_fiscal_invoices_valid
    where issued_date between p_start and p_end
  )
  select
    a.invoices_with_item,
    a.revenue_with_item,
    a.invoices_with_cost,
    a.revenue_with_cost,
    a.total_cost, a.total_icms, a.total_pis_cofins, a.total_difal, a.total_taxes,
    coalesce(a.total_marketplace_fee, 0) as total_marketplace_fee,
    coalesce(a.revenue_without_fee_params, 0) as revenue_without_fee_params,
    a.total_profit,
    case when a.revenue_with_cost > 0 then a.total_profit / a.revenue_with_cost else null end as margin_rate,
    case when a.total_cost > 0 then a.total_profit / a.total_cost else null end as roi,
    o.inv as official_valid_invoices,
    o.rev as official_valid_revenue,
    case when o.rev > 0 then round(100.0 * a.revenue_with_item / o.rev, 2) else 0 end as coverage_item_revenue_pct,
    case when o.rev > 0 then round(100.0 * a.revenue_with_cost / o.rev, 2) else 0 end as coverage_cost_revenue_pct
  from agg a cross join official o;
$$;

grant execute on function public.oraculo_fiscal_margin_lines(date, date) to authenticated;
grant execute on function public.oraculo_fiscal_sku_margin(date, date, integer) to authenticated;
grant execute on function public.oraculo_fiscal_margin_summary(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Snapshot: leva comissão e receita sem faixa para o payload do dashboard.

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
end;
$$;

grant execute on function public.oraculo_capture_fiscal_margin_snapshots() to service_role;
