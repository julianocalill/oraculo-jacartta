create table if not exists public.oraculo_channel_sales_unified_cache (
  order_date date not null,
  source text not null,
  channel_name text not null,
  orders_count bigint not null default 0,
  canceled_orders bigint not null default 0,
  gross_revenue numeric not null default 0,
  net_revenue numeric not null default 0,
  average_ticket numeric,
  refreshed_at timestamptz not null default now(),
  primary key (order_date, source, channel_name)
);

create index if not exists oraculo_channel_sales_unified_cache_date_idx
  on public.oraculo_channel_sales_unified_cache (order_date desc);

create or replace function public.refresh_oraculo_channel_sales_unified_cache(p_start_date date, p_end_date date)
returns bigint
language sql
as $$
  with deleted as (
    delete from public.oraculo_channel_sales_unified_cache cache
    where cache.order_date >= p_start_date
      and cache.order_date <= p_end_date
    returning 1
  ),
  grouped as (
    select
      order_date,
      source,
      coalesce(channel_name, 'Sem canal') as channel_name,
      count(*)::bigint as orders_count,
      count(*) filter (where is_canceled)::bigint as canceled_orders,
      coalesce(sum(gross_amount), 0) as gross_revenue,
      coalesce(sum(net_amount), 0) as net_revenue,
      case
        when count(*) filter (where not is_canceled) = 0 then null::numeric
        else coalesce(sum(net_amount), 0) / nullif(count(*) filter (where not is_canceled), 0)
      end as average_ticket
    from public.oraculo_orders_unified
    where order_date >= p_start_date
      and order_date <= p_end_date
    group by order_date, source, coalesce(channel_name, 'Sem canal')
  ),
  inserted as (
    insert into public.oraculo_channel_sales_unified_cache (
      order_date,
      source,
      channel_name,
      orders_count,
      canceled_orders,
      gross_revenue,
      net_revenue,
      average_ticket,
      refreshed_at
    )
    select
      order_date,
      source,
      channel_name,
      orders_count,
      canceled_orders,
      gross_revenue,
      net_revenue,
      average_ticket,
      now()
    from grouped
    on conflict (order_date, source, channel_name) do update set
      orders_count = excluded.orders_count,
      canceled_orders = excluded.canceled_orders,
      gross_revenue = excluded.gross_revenue,
      net_revenue = excluded.net_revenue,
      average_ticket = excluded.average_ticket,
      refreshed_at = excluded.refreshed_at
    returning 1
  )
  select count(*)::bigint from inserted;
$$;
