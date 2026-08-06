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
