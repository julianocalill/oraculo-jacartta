-- Correção da migração 20260710092000: a lista de tabelas com leitura para
-- `authenticated` estava incompleta e deixou de fora a cadeia fiscal. Com o app
-- lendo via cliente autenticado (anon + JWT) sob RLS, isso zerou os cards fiscais
-- do dashboard (receita faturada, NFs emitidas, ticket) porque
-- oraculo_fiscal_daily_revenue / oraculo_fiscal_invoices_valid / RPCs fiscais
-- dependem de olist_invoices, que não tinha policy/grant para authenticated.
--
-- Aditiva: apenas concede leitura de negócio; não remove acesso de service_role.

do $$
declare
  t text;
  fiscal_tables text[] := array[
    'olist_invoices',
    'olist_invoice_items',
    'olist_products',
    'oraculo_fiscal_invoice_order_links'
  ];
begin
  foreach t in array fiscal_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists oraculo_authenticated_read on public.%I', t);
    execute format(
      'create policy oraculo_authenticated_read on public.%I for select to authenticated using (true)',
      t
    );
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Views fiscais lidas pelo app / usadas nas RPCs: security definer + grant, para
-- não depender de grants em cascata nas tabelas base.
do $$
declare
  v text;
  fiscal_views text[] := array[
    'oraculo_fiscal_invoices_valid',
    'oraculo_fiscal_channel_sales'
  ];
begin
  foreach v in array fiscal_views loop
    execute format('alter view public.%I set (security_invoker = false)', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;
