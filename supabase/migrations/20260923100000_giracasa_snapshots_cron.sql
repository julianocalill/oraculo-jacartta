-- Giracasa: captura horária dos snapshots fiscais.
--
-- Depois da ativação (22/09) a Home ficou sem margem, ROI, variação e os
-- gráficos dos cards: eles vêm de oraculo_fiscal_snapshots, e a Giracasa nunca
-- teve o job que alimenta essa tabela. Todas as outras fontes da Home já
-- estavam populadas (receita fiscal diária, canais, vendas diárias, SKUs e
-- estoque); só os snapshots estavam zerados.
--
-- Espelha oraculo-fiscal-margin-snapshots-hourly (Uberlândia, :14), inclusive a
-- limpeza de 14 dias, no minuto :45 para não cair sobre os jobs pesados do
-- banco (:12/:42 take-rate, :14 snapshots de Uberlândia, :23 qty, :34 nf-cache,
-- :47 comercial, :51-:55 SKU unificado).

select cron.schedule(
  'giracasa-fiscal-margin-snapshots-hourly',
  '45 * * * *',
  $cron$
    select giracasa.oraculo_capture_fiscal_margin_snapshots();
    delete from giracasa.oraculo_fiscal_snapshots
    where captured_at < now() - interval '14 days'
      and snapshot_key in ('fiscal_margin_summary', 'fiscal_sku_margin', 'fiscal_channel_metrics');
  $cron$
);
