-- Corrige um travamento do cache de NF de venda descoberto no backfill de
-- maio/junho: a chamada processou 62 dias e gravou ZERO linhas.
--
-- Causa: a função inferia "dia já processado" pela EXISTÊNCIA de linhas de
-- cache naquele dia. Maio/2026 não tem nenhuma NF em olist_invoices (a base
-- começa em junho), então todo dia de maio ficava eternamente "não coberto":
-- cada iteração do laço reescolhia 2026-05-01, inseria 0 linhas, e a iteração
-- seguinte reescolhia o mesmo dia. O laço girava em falso e nunca alcançava
-- junho.
--
-- O mesmo defeito travaria o cron horário para sempre — no formato mais caro
-- possível, o silencioso: rodando, sem erro, sem nunca avançar.
--
-- Correção: controle explícito de dias processados. Um dia sem nenhuma NF é um
-- dia processado com 0 linhas, não um dia pendente.

create table if not exists public.oraculo_olist_order_ref_cache_days (
  day date primary key,
  rows_upserted integer not null default 0,
  refreshed_at timestamptz not null default now()
);

alter table public.oraculo_olist_order_ref_cache_days enable row level security;
revoke all on table public.oraculo_olist_order_ref_cache_days from public, anon, authenticated;
grant all on table public.oraculo_olist_order_ref_cache_days to service_role;
grant select on table public.oraculo_olist_order_ref_cache_days to authenticated;
create policy oraculo_olist_order_ref_cache_days_authenticated_read
  on public.oraculo_olist_order_ref_cache_days for select to authenticated using (true);

-- Dias já materializados antes desta correção (julho em diante) entram como
-- processados para o backfill não refazer o trabalho.
insert into public.oraculo_olist_order_ref_cache_days (day, rows_upserted, refreshed_at)
select emission_date::date, count(*), max(refreshed_at)
  from public.oraculo_olist_order_ref_cache
 group by 1
on conflict (day) do nothing;

create or replace function public.refresh_oraculo_olist_order_ref_cache(p_days integer default 1)
returns table (processed_day date, rows_upserted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_count integer;
begin
  for i in 1..greatest(p_days, 1) loop
    -- Pendente = nunca processado, ou processado há mais de 20h e ainda dentro
    -- da janela quente (últimos 3 dias, onde a Olist ainda emite/corrige NF).
    -- 2026-05-01 é o lastro: a venda que gerou a devolução costuma ser anterior.
    select d::date into v_day
      from generate_series(date '2026-05-01', (now() at time zone 'UTC')::date, interval '1 day') d
      left join public.oraculo_olist_order_ref_cache_days c on c.day = d::date
     where c.day is null
        or (c.refreshed_at < now() - interval '20 hours'
            and d::date >= (now() at time zone 'UTC')::date - 3)
     order by d
     limit 1;

    if v_day is null then
      return;
    end if;

    insert into public.oraculo_olist_order_ref_cache
      (invoice_id, order_ref, channel_label, emission_date, client_document, total_amount, refreshed_at)
    select i.id,
           nullif(i.raw_json->'ecommerce'->>'numeroPedidoEcommerce', ''),
           nullif(i.raw_json->'ecommerce'->>'nome', ''),
           i.emission_date,
           i.client_document,
           i.total_amount,
           now()
      from public.olist_invoices i
     where i.fiscal_invoice_type = 'S'
       and i.emission_date >= v_day
       and i.emission_date < v_day + interval '1 day'
    on conflict (invoice_id) do update
      set order_ref      = excluded.order_ref,
          channel_label  = excluded.channel_label,
          emission_date  = excluded.emission_date,
          client_document= excluded.client_document,
          total_amount   = excluded.total_amount,
          refreshed_at   = excluded.refreshed_at;

    get diagnostics v_count = row_count;

    -- Marcar SEMPRE, inclusive com 0 linhas: é isso que faz o laço avançar.
    insert into public.oraculo_olist_order_ref_cache_days (day, rows_upserted, refreshed_at)
    values (v_day, v_count, now())
    on conflict (day) do update
      set rows_upserted = excluded.rows_upserted,
          refreshed_at  = excluded.refreshed_at;

    processed_day := v_day;
    rows_upserted := v_count;
    return next;
  end loop;
end;
$$;

grant execute on function public.refresh_oraculo_olist_order_ref_cache(integer) to service_role;
