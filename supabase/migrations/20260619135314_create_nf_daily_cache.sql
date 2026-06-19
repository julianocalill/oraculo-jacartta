create table if not exists public.oraculo_nf_daily_cache (
  nf_date date primary key,
  confirmed_revenue numeric not null default 0,
  emitted_count bigint not null default 0,
  canceled_count bigint not null default 0,
  pending_count bigint not null default 0,
  refreshed_at timestamptz not null default now()
);

alter table public.oraculo_nf_daily_cache enable row level security;

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
  emitted as (
    select
      (o.payload->>'dataFaturamento')::date as nf_date,
      count(*)::bigint as emitted_count,
      sum(coalesce(
        public.oraculo_parse_numeric(o.payload->>'valorTotalPedido'),
        public.oraculo_parse_numeric(o.payload->>'valor'),
        public.oraculo_parse_numeric(o.payload->>'valorTotalProdutos'),
        0
      )) as confirmed_revenue
    from public.olist_orders o
    cross join bounds b
    where nullif(o.payload->>'dataFaturamento', '') is not null
      and (o.payload->>'dataFaturamento')::date >= b.start_date
      and (o.payload->>'dataFaturamento')::date < b.end_date
      and coalesce(o.situacao, o.payload->>'situacao', '') <> '8'
    group by (o.payload->>'dataFaturamento')::date
  ),
  canceled as (
    select
      o.data_criacao::date as nf_date,
      count(*)::bigint as canceled_count
    from public.olist_orders o
    cross join bounds b
    where coalesce(o.situacao, o.payload->>'situacao', '') = '8'
      and o.data_criacao::date >= b.start_date
      and o.data_criacao::date < b.end_date
    group by o.data_criacao::date
  ),
  pending as (
    select
      o.data_criacao::date as nf_date,
      count(*)::bigint as pending_count
    from public.olist_orders o
    cross join bounds b
    where coalesce(o.situacao, o.payload->>'situacao', '') <> '8'
      and o.data_criacao::date >= b.start_date
      and o.data_criacao::date < b.end_date
      and nullif(o.payload->>'dataFaturamento', '') is null
    group by o.data_criacao::date
  ),
  dates as (
    select nf_date from emitted
    union
    select nf_date from canceled
    union
    select nf_date from pending
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
    dates.nf_date,
    coalesce(emitted.confirmed_revenue, 0),
    coalesce(emitted.emitted_count, 0),
    coalesce(canceled.canceled_count, 0),
    coalesce(pending.pending_count, 0),
    now()
  from dates
  left join emitted using (nf_date)
  left join canceled using (nf_date)
  left join pending using (nf_date);
$$;

create or replace function public.oraculo_nf_metrics(start_date date, end_date date)
returns table (
  confirmed_revenue numeric,
  emitted_count bigint,
  canceled_count bigint,
  pending_count bigint
)
language sql
stable
as $$
  select
    coalesce(sum(cache.confirmed_revenue), 0) as confirmed_revenue,
    coalesce(sum(cache.emitted_count), 0)::bigint as emitted_count,
    coalesce(sum(cache.canceled_count), 0)::bigint as canceled_count,
    coalesce(sum(cache.pending_count), 0)::bigint as pending_count
  from public.oraculo_nf_daily_cache cache
  where cache.nf_date >= start_date
    and cache.nf_date <= end_date;
$$;

select public.refresh_oraculo_nf_daily_cache((current_date - interval '180 days')::date, (current_date + interval '1 day')::date);
