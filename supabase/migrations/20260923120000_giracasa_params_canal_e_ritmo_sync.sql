-- Giracasa: parâmetros de canal e ritmo da sincronização.
--
-- 1) PARÂMETROS DE CANAL
-- A aba SKUs não calculava margem porque giracasa.oraculo_margin_channel_params
-- estava vazia (Uberlândia tem duas linhas). Valores definidos com o usuário em
-- 23/09/2026:
--   * imposto 27,26% — medido nas linhas fiscais da Giracasa nos últimos 30
--     dias (ICMS + PIS/COFINS + DIFAL sobre a receita). É maior que os 12,59%
--     de Uberlândia porque a operação é SP e paga DIFAL (6,24% da receita);
--   * taxa de marketplace e de pagamento iguais às da Shopee em Uberlândia,
--     conforme confirmação de que as taxas da Shopee são as mesmas. O medido
--     na Giracasa (28,38%) bate com os 28,83% cadastrados;
--   * frete subsidiado, margem alvo e mínima iguais às de Uberlândia.
--
-- Esses parâmetros alimentam só a margem operacional da aba SKUs. A margem
-- fiscal (Home, /export-fiscal) continua vindo do motor gira-casa-v2, que
-- calcula imposto por nota, UF e origem.
--
-- 2) RITMO DA SINCRONIZAÇÃO
-- As notas emitidas hoje demoravam até ~8h para aparecer: a varredura cobre uma
-- janela de 3 dias (2.387 notas) em ordem decrescente, a 150 notas por rodada,
-- e notas novas só entram quando a varredura recomeça. Aumentando o lote e
-- encurtando a janela para 2 dias, a volta completa cai para menos de 2h.

insert into giracasa.oraculo_margin_channel_params (
  source, channel_key, display_name, tax_rate, marketplace_fee_rate, payment_fee_rate,
  freight_subsidy_per_unit, packaging_cost_per_unit, target_margin_rate, minimum_margin_rate,
  params_configured, notes
)
values
  ('olist', '*', 'Olist — padrão', 0.2726, 0.2838, 0.06, 1.00, 0, 0.25, 0.12, true,
   'Imposto medido nas linhas fiscais da Giracasa (30 dias, inclui DIFAL). Tarifa medida nos canais com tabela cadastrada. Definido em 23/09/2026.'),
  ('shopee', '*', 'Shopee — padrão', 0.2726, 0.2883, 0.06, 1.00, 0, 0.25, 0.12, true,
   'Taxas da Shopee iguais às de Uberlândia, por confirmação do usuário em 23/09/2026. Imposto medido na Giracasa.')
on conflict (source, channel_key) do update set
  tax_rate = excluded.tax_rate,
  marketplace_fee_rate = excluded.marketplace_fee_rate,
  payment_fee_rate = excluded.payment_fee_rate,
  freight_subsidy_per_unit = excluded.freight_subsidy_per_unit,
  packaging_cost_per_unit = excluded.packaging_cost_per_unit,
  target_margin_rate = excluded.target_margin_rate,
  minimum_margin_rate = excluded.minimum_margin_rate,
  params_configured = excluded.params_configured,
  notes = excluded.notes,
  updated_at = now();

-- Notas: 2 dias de janela, 500 notas por rodada (era 150), a cada 30 minutos.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'giracasa-olist-invoices-30m'),
  command => $cron$select oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-sync-invoices',
      '{"lookbackDays": 2, "pageSize": 100, "maxPages": 5, "detailDelayMs": 200}'::jsonb,
      280000
    );$cron$
);

-- Pedidos: mesma lógica, 400 por rodada.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'giracasa-olist-orders-hourly'),
  command => $cron$select oraculo_private.invoke_giracasa_olist_function(
      'giracasa-olist-sync-orders',
      '{"lookbackDays": 2, "pageSize": 100, "maxPages": 4}'::jsonb,
      280000
    );$cron$
);
