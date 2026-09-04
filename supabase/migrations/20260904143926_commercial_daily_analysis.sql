-- Análise Comercial: a data é a emissão da NF válida. Usa o motor fiscal
-- canônico, sem somar a venda Shopee direta novamente e sem recalcular tributos.
-- Dados agregados de negócio, sem dados pessoais: leitura authenticated + RLS.
begin;
create table public.oraculo_commercial_daily (
  day date not null,
  channel text not null,
  sku text not null,
  product_name text,
  units numeric not null,
  revenue numeric not null,
  cost numeric not null,
  taxes numeric not null,
  fees numeric not null,
  covered_revenue numeric not null,
  covered_profit numeric not null,
  missing_cost_lines bigint not null,
  missing_fee_lines bigint not null,
  primary key (day, channel, sku)
);
create table public.oraculo_commercial_coverage (
  day date not null,
  channel text not null,
  invoices bigint not null,
  revenue numeric not null,
  primary key (day, channel)
);
create table public.oraculo_commercial_days (
  day date primary key,
  refreshed_at timestamptz not null default now()
);
comment on table public.oraculo_commercial_daily is 'Análise Comercial: unidades e receita por emissão da NF, canal e SKU. Motor oraculo_fiscal_margin_lines; somente canais identificados, sem duplicação Shopee direta. Atualização horária.';
comment on column public.oraculo_commercial_daily.day is 'Data de emissão da NF válida, não data de criação ou pagamento do pedido.';
comment on column public.oraculo_commercial_daily.units is 'Quantidade das linhas do motor fiscal: item comercial preferencial, item fiscal como fallback. Kits seguem a unidade da fonte; não representa peças físicas uniformes.';
comment on column public.oraculo_commercial_daily.revenue is 'Valor da NF válida rateado pelo motor fiscal; nunca soma preços de lista dos itens como receita.';
comment on column public.oraculo_commercial_daily.cost is 'Soma do custo líquido conhecido resolvido pelo motor fiscal canônico, incluindo overrides e componentes de kits.';
comment on column public.oraculo_commercial_daily.covered_revenue is 'Receita somente das linhas com custo e comissão configurados; denominador da margem parcial ponderada.';
comment on column public.oraculo_commercial_daily.covered_profit is 'Receita menos custo líquido, impostos e comissão nas linhas completas. Não é lucro líquido contábil; não desconta Ads, despesas fixas, frete externo ou devoluções posteriores.';
comment on table public.oraculo_commercial_coverage is 'Totais de NFs válidas com canal por dia, incluindo NFs sem itens; permite medir a receita ainda fora do ranking por SKU.';
comment on table public.oraculo_commercial_days is 'Dias processados da Análise Comercial, inclusive dias com zero vendas. refreshed_at detecta atraso e controla a revisão histórica.';
comment on column public.oraculo_commercial_days.refreshed_at is 'Última conclusão atômica do cálculo do dia. Janela recente horária; histórico revisado por lotes.';

alter table public.oraculo_commercial_daily enable row level security;
alter table public.oraculo_commercial_coverage enable row level security;
alter table public.oraculo_commercial_days enable row level security;
create policy commercial_read on public.oraculo_commercial_daily for select to authenticated using (true);
create policy commercial_read on public.oraculo_commercial_coverage for select to authenticated using (true);
create policy commercial_read on public.oraculo_commercial_days for select to authenticated using (true);
revoke all on public.oraculo_commercial_daily, public.oraculo_commercial_coverage, public.oraculo_commercial_days from anon;
grant select on public.oraculo_commercial_daily, public.oraculo_commercial_coverage, public.oraculo_commercial_days to authenticated;
grant all on public.oraculo_commercial_daily, public.oraculo_commercial_coverage, public.oraculo_commercial_days to service_role;

create function public.oraculo_refresh_commercial(p_start date, p_end date)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 30 then
    raise exception 'O refresh exige um intervalo de 1 a 31 dias';
  end if;
  -- Cron e backfill não podem sobrescrever a mesma janela simultaneamente.
  perform pg_advisory_xact_lock(hashtext('oraculo-commercial-refresh'));
  delete from public.oraculo_commercial_daily where day between p_start and p_end;
  insert into public.oraculo_commercial_daily
  select inv.issued_date, l.channel_label, coalesce(nullif(btrim(l.sku), ''), ''),
    max(p.nome), sum(l.quantity), sum(l.revenue), coalesce(sum(l.cost), 0),
    sum(l.taxes_total), sum(l.marketplace_fee),
    coalesce(sum(l.revenue) filter (where not l.cost_missing and not l.fee_missing), 0),
    coalesce(sum(l.profit) filter (where not l.cost_missing and not l.fee_missing), 0),
    count(*) filter (where l.cost_missing), count(*) filter (where l.fee_missing)
  from public.oraculo_fiscal_margin_lines(p_start, p_end) l
  join public.oraculo_fiscal_invoices_valid inv on inv.id = l.invoice_id
  left join public.olist_products p on p.id = l.produto_id
  where nullif(btrim(l.channel_label), '') is not null and l.channel_label <> 'Sem canal'
  group by inv.issued_date, l.channel_label, coalesce(nullif(btrim(l.sku), ''), '');

  delete from public.oraculo_commercial_coverage where day between p_start and p_end;
  insert into public.oraculo_commercial_coverage
  select issued_date, channel_label, count(*), coalesce(sum(billed_revenue), 0)
  from public.oraculo_fiscal_invoices_valid
  where issued_date between p_start and p_end
    and nullif(btrim(channel_label), '') is not null and channel_label <> 'Sem canal'
  group by issued_date, channel_label;
  insert into public.oraculo_commercial_days (day, refreshed_at)
  select d::date, now() from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') d
  on conflict (day) do update set refreshed_at = excluded.refreshed_at;
end;
$$;
revoke all on function public.oraculo_refresh_commercial(date,date) from public, anon, authenticated;
grant execute on function public.oraculo_refresh_commercial(date,date) to service_role;
comment on function public.oraculo_refresh_commercial(date,date) is 'Atualiza atomicamente até 31 dias de vendas comerciais faturadas usando o motor fiscal existente. Execução interna (cron/service_role); não é chamada no carregamento da página.';

create function public.oraculo_commercial_tick()
returns void language plpgsql security invoker set search_path = '' as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  oldest_day date;
  first_day date;
begin
  perform public.oraculo_refresh_commercial(today - 9, today);
  select min(issued_date) into first_day from public.oraculo_fiscal_invoices_valid;
  -- Dias sem dados também entram no controle. Prioriza os ainda não calculados,
  -- do mais recente ao mais antigo, depois revisa o histórico mais desatualizado.
  select d::date into oldest_day
  from generate_series(first_day::timestamp, (today - 10)::timestamp, interval '1 day') d
  left join public.oraculo_commercial_days c on c.day = d::date
  order by (c.day is null) desc, c.refreshed_at asc nulls first, d desc limit 1;
  if oldest_day is not null then
    perform public.oraculo_refresh_commercial(greatest(first_day, oldest_day - 6), oldest_day);
  end if;
end;
$$;
revoke all on function public.oraculo_commercial_tick() from public, anon, authenticated;
grant execute on function public.oraculo_commercial_tick() to service_role;
comment on function public.oraculo_commercial_tick() is 'Cron horário: recalcula últimos 10 dias e um lote histórico de até 7 dias, priorizando datas não processadas. Revisão histórica reflete mudanças de custos e backfills; observar refreshed_at.';

create function public.oraculo_commercial_analysis(p_start date, p_end date, p_channel text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 365 then
    raise exception 'Selecione um intervalo válido de até 366 dias';
  end if;
  with rows as materialized (
    select * from public.oraculo_commercial_daily
    where day between p_start and p_end and (p_channel is null or channel = p_channel)
  ), products as (
    select sku, max(product_name) as product_name, sum(units) as units,
      sum(revenue) as revenue, sum(cost) as cost, sum(taxes) as taxes, sum(fees) as fees,
      sum(covered_revenue) as covered_revenue, sum(covered_profit) as covered_profit,
      sum(missing_cost_lines) as missing_cost_lines, sum(missing_fee_lines) as missing_fee_lines
    from rows group by sku
  ), daily as (
    select day, sum(invoices) as invoices, sum(revenue) as revenue
    from public.oraculo_commercial_coverage
    where day between p_start and p_end and (p_channel is null or channel = p_channel)
    group by day
  )
  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by units desc, revenue desc, sku) from products p), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(channel order by channel) from (select distinct channel from public.oraculo_commercial_coverage where day between p_start and p_end) c), '[]'::jsonb),
    'processed_days', (select count(*) from public.oraculo_commercial_days where day between p_start and p_end),
    'oldest_refresh', (select min(refreshed_at) from public.oraculo_commercial_days where day between p_start and p_end),
    'latest_refresh', (select max(refreshed_at) from public.oraculo_commercial_days where day between p_start and p_end),
    'recent_refresh', (select min(refreshed_at) from public.oraculo_commercial_days where day between greatest(p_start, (now() at time zone 'America/Sao_Paulo')::date - 9) and p_end)
  ) into result;
  return result;
end;
$$;
revoke all on function public.oraculo_commercial_analysis(date,date,text) from public, anon;
grant execute on function public.oraculo_commercial_analysis(date,date,text) to authenticated, service_role;
comment on function public.oraculo_commercial_analysis(date,date,text) is 'Consulta leve da Análise Comercial por emissão da NF e canal. JSON agregado evita truncamento de 1.000 linhas do PostgREST. Totais completos e controle explícito dos dias processados; margem só nas linhas com custo e comissão.';

select cron.schedule('oraculo-commercial-hourly', '42 * * * *',
  $job$set statement_timeout = '5min'; select public.oraculo_commercial_tick();$job$);
commit;
