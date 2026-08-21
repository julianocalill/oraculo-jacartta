-- Descrição das funções (RPC) chamáveis por `authenticated`.
--
-- São as análises prontas que rodam igual no Metabase e no PowerBI:
-- `select * from oraculo_fiscal_sku_margin('2026-08-01','2026-08-31', 200)`.
-- Usar a função em vez de reescrever a conta no BI é o que mantém o número
-- igual ao da tela do Oráculo.
--
-- COMMENT ON FUNCTION exige a lista de tipos SEM os defaults
-- (pg_get_function_identity_arguments), não a assinatura completa.

-- ── Métricas fiscais ───────────────────────────────────────────────────────
comment on function public.oraculo_fiscal_metrics(date, date) is
  'Métricas fiscais consolidadas do período: receita faturada, impostos, comissões e margem. Base dos cards de Analytics.';
comment on function public.oraculo_fiscal_channel_metrics(date, date) is
  'Métricas fiscais quebradas por canal no período.';
comment on function public.oraculo_fiscal_margin_summary(date, date) is
  'Resumo de margem fiscal do período: receita, custo, impostos, comissão e resultado.';
comment on function public.oraculo_fiscal_margin_lines(date, date) is
  'Linhas de margem fiscal do período, uma por item faturado — o detalhe por trás do resumo.';
comment on function public.oraculo_fiscal_sku_margin(date, date, integer) is
  'MARGEM E ROI POR SKU no período, com decomposição de imposto e comissão. Usa o livro de custo canônico (oraculo_sku_unit_cost). Prefira esta função à view oraculo_sku_margin_30d, que não separa canal e é distorcida por pedido B2B. Parâmetros: início, fim, quantos SKUs.';
comment on function public.oraculo_nf_metrics(date, date) is
  'Métricas de notas fiscais emitidas no período: contagem, valor e ticket médio.';
comment on function public.oraculo_reconciliation_snapshot(date, date) is
  'Reconciliação entre pedidos e notas fiscais no período. Ferramenta de auditoria: mostra o que não fecha.';
comment on function public.oraculo_fiscal_order_item_backfill_progress(date, date) is
  'Progresso do backfill de itens fiscais no período. Diagnóstico operacional.';

-- ── Ranking e volume ───────────────────────────────────────────────────────
comment on function public.oraculo_top_products_qty(date, date, integer) is
  'TOP SKUs POR UNIDADE vendida no período. Já exclui os pedidos sem canal, que são lançamentos B2B feitos direto no ERP — um único deles carregou 213.960 unidades e reescreveria o ranking. Parâmetros: início, fim, quantos SKUs.';
comment on function public.oraculo_top_channels_qty(date, date) is
  'Volume de pedidos e unidades por canal no período. A contagem de pedidos vem de olist_orders, não dos itens.';
comment on function public.oraculo_sku_period_rank(date, date, integer) is
  'Ranking de SKUs por receita no período, base Olist.';
comment on function public.oraculo_sku_period_rank_unified(date, date, integer, text) is
  'Ranking de SKUs por receita no período, unificando canais. O último parâmetro filtra a fonte — use-o: olist e shopee são a mesma venda.';
comment on function public.oraculo_olist_period_coverage(date, date) is
  'Cobertura de itens dos pedidos da Olist no período. Leia antes de confiar em qualquer número de unidades: cobertura baixa significa piso, não total.';
comment on function public.oraculo_olist_last_order_date() is
  'Data do pedido mais recente já sincronizado da Olist. Use para saber até onde os dados vão.';

-- ── Curvas ─────────────────────────────────────────────────────────────────
comment on function public.oraculo_sales_curve() is
  'Curva ABC de saída por SKU (80/15/5 por receita). Lê a materialized view, que não é acessível diretamente por authenticated.';
comment on function public.oraculo_sales_curve_channels() is
  'Curva ABC de saída quebrada por canal.';
comment on function public.oraculo_sales_curve_volume(date, date, text, boolean) is
  'CURVA ABC POR VOLUME com filtro de período e canal. Deixe o último parâmetro em true para excluir pedidos sem canal: com false, um pedido B2B de 200 mil unidades reescreve a curva inteira. Parâmetros: início, fim, canal (null = todos), excluir sem canal.';
comment on function public.oraculo_stock_coverage_curve() is
  'Curva de cobertura de estoque. Lê a materialized view, que não é acessível diretamente por authenticated.';

-- ── Previsão de vendas ─────────────────────────────────────────────────────
comment on function public.oraculo_sales_forecast_week(date) is
  'Previsão de unidades para a semana alvo (null = próxima semana), com cenário baixo e alto. Média das semanas completas x tendência limitada a mais ou menos 30%.';
comment on function public.oraculo_sales_forecast_daily(date) is
  'Previsão distribuída por dia da semana, usando o peso histórico de cada dia.';
comment on function public.oraculo_sales_forecast_skus(date) is
  'Previsão da semana alvo quebrada por SKU.';
comment on function public.oraculo_sales_forecast_channels(date) is
  'Previsão da semana alvo quebrada por canal, pelo share histórico de cada um.';
comment on function public.oraculo_sales_forecast_backtest(integer) is
  'Backtest da previsão: compara o previsto com o realizado nas últimas N semanas. Leia antes de confiar na previsão.';

-- ── Devoluções ─────────────────────────────────────────────────────────────
comment on function public.oraculo_returns_summary(timestamp with time zone, timestamp with time zone, text) is
  'Resumo de devoluções no período: volume, valor e taxa sobre as vendas. Já exclui devolução recusada, que não é perda.';
comment on function public.oraculo_returns_daily(timestamp with time zone, timestamp with time zone, text) is
  'Série diária de devoluções no período.';
comment on function public.oraculo_returns_by_reason(timestamp with time zone, timestamp with time zone, text) is
  'DEVOLUÇÕES POR MOTIVO no período, com os motivos já padronizados pelo de-para. Parâmetros: início, fim, canal (null = todos).';
comment on function public.oraculo_returns_by_sku(timestamp with time zone, timestamp with time zone, text, integer) is
  'Devoluções por SKU no período — quais produtos voltam mais.';
comment on function public.oraculo_returns_channels(timestamp with time zone, timestamp with time zone) is
  'Devoluções por canal no período.';
comment on function public.oraculo_returns_funnel(timestamp with time zone, timestamp with time zone, text) is
  'Funil de devoluções: cada etapa soma ao topo. Se não somar, alguma etapa está faltando — foi assim que a etapa cancelada foi descoberta.';
comment on function public.oraculo_returns_disputes(timestamp with time zone, timestamp with time zone, text) is
  'Devoluções em disputa no período.';
comment on function public.oraculo_return_counts_as_loss(text) is
  'Diz se um status de devolução conta como perda. Devolução recusada NÃO conta (37% das linhas do TikTok). Use em vez de comparar texto de status na mão.';

-- ── Expedição ──────────────────────────────────────────────────────────────
comment on function public.oraculo_fulfillment_summary(date, date, bigint) is
  'Resumo de expedição no período, opcionalmente por loja.';
comment on function public.oraculo_fulfillment_daily(date, date, bigint) is
  'Série diária de expedição no período, opcionalmente por loja.';
comment on function public.oraculo_fulfillment_by_shop(date, date) is
  'Expedição por loja no período.';
comment on function public.oraculo_fulfillment_operational_summary(date, bigint) is
  'Visão operacional da expedição do dia: o que falta despachar agora.';
comment on function public.oraculo_fulfillment_operational_by_shop(date) is
  'Visão operacional da expedição do dia, quebrada por loja.';

-- ── Helpers de custo e conversão ───────────────────────────────────────────
comment on function public.oraculo_net_cost(numeric, text) is
  'Converte custo bruto em custo líquido descontando os créditos de imposto conforme a origem (nacional ou importado).';
comment on function public.oraculo_net_cost_rate(text) is
  'Taxa de crédito de imposto aplicada por origem. Base de oraculo_net_cost.';
comment on function public.oraculo_money_value(text) is
  'Converte texto em valor monetário, tolerando os formatos que as APIs devolvem. Helper.';
comment on function public.oraculo_parse_numeric(text) is
  'Converte texto em número, devolvendo nulo em vez de erro quando não dá. Helper.';

-- ── Outros ─────────────────────────────────────────────────────────────────
comment on function public.importacao_fatura_entregue(text, date) is
  'Diz se uma fatura de importação já foi entregue, combinando status logístico e data de chegada no porto.';
comment on function public.shopee_ads_report_dataset(date) is
  'Conjunto de dados do relatório de Shopee Ads até a data de fim do período.';
comment on function public.oraculo_agenda_is_participant(uuid) is
  'Helper de RLS da Agenda: diz se o usuário atual participa da tarefa. Uso interno das policies.';
