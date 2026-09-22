-- Giracasa: crons de ingestão contínua (etapa anterior à ativação).
--
-- Até agora o único job giracasa-* era o de renovação do token da Shopee. Sem
-- nenhum job da Olist, o refresh token da Giracasa expirou duas vezes (11/09 e
-- 16/09) e os dados congelaram em 07/09. Qualquer invocação das funções de sync
-- renova o token, então a sincronização de notas também resolve isso.
--
-- Grade: só minutos de baixa ocupação (:19, :29, :39, :49, :59), respeitando o
-- teto de 2 jobs por minuto e a regra de janela de execução registrada em
-- docs/deployment-map.md. Nenhum job de Uberlândia é alterado.
--
-- Caches pesados (margem por SKU, snapshots fiscais, curva) ficam de fora: eles
-- entram na migration de ativação, junto com enabled=true, conforme o checklist
-- de docs/giracasa-onboarding.md.

do $$
begin
  -- Notas fiscais a cada 30 min: mantém a receita corrente e o token da Olist vivo.
  perform cron.schedule(
    'giracasa-olist-invoices-30m',
    '19,49 * * * *',
    $cron$select oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-sync-invoices',
      '{"lookbackDays": 3, "pageSize": 50, "maxPages": 3}'::jsonb,
      280000
    );$cron$
  );

  -- Pedidos de hora em hora.
  perform cron.schedule(
    'giracasa-olist-orders-hourly',
    '29 * * * *',
    $cron$select oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-sync-orders',
      '{"lookbackDays": 3, "maxPages": 3}'::jsonb,
      280000
    );$cron$
  );

  -- Itens de pedido em atraso, na madrugada.
  perform cron.schedule(
    'giracasa-olist-order-items-backfill',
    '39 4-8 * * *',
    $cron$select oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-backfill-order-items',
      '{"maxOrders": 200}'::jsonb,
      280000
    );$cron$
  );

  -- Vínculo NF -> pedido dos últimos 3 dias.
  perform cron.schedule(
    'giracasa-fiscal-order-links-hourly',
    '59 * * * *',
    $cron$select giracasa.refresh_oraculo_fiscal_invoice_order_links(
      (current_date - interval '3 days')::date, current_date
    );$cron$
  );

  -- Cache de quantidades por canal: alimenta a cobertura de pedidos, hoje zerada.
  perform cron.schedule(
    'giracasa-olist-qty-cache-hourly',
    '39 * * * *',
    $cron$select giracasa.refresh_oraculo_olist_qty_cache(10);$cron$
  );
end $$;
