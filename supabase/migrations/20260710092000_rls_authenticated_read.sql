-- Leitura de negócio via `authenticated` (anon key + JWT do usuário), tirando a
-- service-role key do caminho de leitura do web app. É aditiva: não remove nenhum
-- acesso de service_role, então /status, /usuarios (auth.admin) e as Server Actions
-- de escrita continuam funcionando com a service-role como antes.
--
-- Modelo: o Oráculo é BI interno; todo usuário autenticado é um operador interno
-- (criado via /usuarios) e pode ler todos os dados de negócio. Por isso as policies
-- são `using (true)` (sem filtragem por linha) e as views/RPCs de leitura passam a
-- `security definer` para não exigir grants em cascata nas tabelas base.
--
-- IMPORTANTE: aplicar esta migration ANTES de publicar o web app que usa o cliente
-- autenticado, e validar cada página em Vercel Preview antes de produção.

-- 1) Views de leitura: security definer + grant select para authenticated.
--    (rodam com o privilégio do owner, então não precisam de grant nas tabelas base)
do $$
declare
  v text;
  read_views text[] := array[
    'oraculo_daily_sales',
    'oraculo_sku_current_unified',
    'oraculo_sku_margin_30d',
    'oraculo_stock_watchlist_unified',
    'oraculo_fiscal_daily_revenue',
    'oraculo_fiscal_latest_snapshots'
  ];
begin
  foreach v in array read_views loop
    execute format('alter view public.%I set (security_invoker = false)', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- 2) Tabelas lidas diretamente pelo app: RLS + policy de leitura + grant select.
do $$
declare
  t text;
  read_tables text[] := array[
    'oraculo_channel_sales_unified_cache',
    'oraculo_margin_channel_params',
    'oraculo_margin_sku_params',
    'oraculo_state_tax_params',
    'olist_orders',
    'shopee_orders',
    'olist_order_items'
  ];
begin
  foreach t in array read_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists oraculo_authenticated_read on public.%I', t);
    execute format(
      'create policy oraculo_authenticated_read on public.%I for select to authenticated using (true)',
      t
    );
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 3) RPCs de leitura: security definer + search_path fixo + grant execute.
--    As de curva leem materialized views; como definer, não precisamos expor as MVs.
do $$
declare
  fn text;
  read_funcs text[] := array[
    'public.oraculo_nf_metrics(date, date)',
    'public.oraculo_fiscal_channel_metrics(date, date)',
    'public.oraculo_sales_curve()',
    'public.oraculo_stock_coverage_curve()'
  ];
begin
  foreach fn in array read_funcs loop
    execute format('alter function %s security definer', fn);
    execute format('alter function %s set search_path = public', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
