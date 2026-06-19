create or replace function public.refresh_oraculo_nf_daily_cache(start_date date default null, end_date date default null)
returns void
language sql
as $$
  with bounds as (
    select
      coalesce(start_date, current_date - interval '180 days')::date as start_date,
      coalesce(end_date, current_date + interval '1 day')::date as end_date
  ),
  deleted as (
    delete from public.oraculo_nf_daily_cache cache
    using bounds b
    where cache.nf_date >= b.start_date
      and cache.nf_date < b.end_date
    returning cache.nf_date
  ),
  source as (
    select
      o.data_criacao::date as nf_date,
      coalesce(o.situacao, o.payload->>'situacao', '') as status_code,
      coalesce(
        public.oraculo_parse_numeric(o.payload->>'valorTotalPedido'),
        public.oraculo_parse_numeric(o.payload->>'valor'),
        public.oraculo_parse_numeric(o.payload->>'valorTotalProdutos'),
        0
      ) as nf_value
    from public.olist_orders o
    cross join bounds b
    where o.data_criacao::date >= b.start_date
      and o.data_criacao::date < b.end_date
  ),
  grouped as (
    select
      nf_date,
      sum(case when status_code not in ('0', '8') then nf_value else 0 end) as confirmed_revenue,
      count(*) filter (where status_code not in ('0', '8'))::bigint as emitted_count,
      count(*) filter (where status_code = '8')::bigint as canceled_count,
      count(*) filter (where status_code = '0')::bigint as pending_count
    from source
    group by nf_date
  )
  insert into public.oraculo_nf_daily_cache (
    nf_date,
    confirmed_revenue,
    emitted_count,
    canceled_count,
    pending_count,
    refreshed_at
  )
  select
    nf_date,
    coalesce(confirmed_revenue, 0),
    coalesce(emitted_count, 0),
    coalesce(canceled_count, 0),
    coalesce(pending_count, 0),
    now()
  from grouped
  on conflict (nf_date) do update set
    confirmed_revenue = excluded.confirmed_revenue,
    emitted_count = excluded.emitted_count,
    canceled_count = excluded.canceled_count,
    pending_count = excluded.pending_count,
    refreshed_at = excluded.refreshed_at;
$$;

select public.refresh_oraculo_nf_daily_cache((current_date - interval '180 days')::date, (current_date + interval '1 day')::date);
