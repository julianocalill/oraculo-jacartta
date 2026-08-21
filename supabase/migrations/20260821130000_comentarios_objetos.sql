-- Descrição de todos os 121 objetos do schema public.
--
-- Escrito como COMMENT ON de propósito: a descrição passa a viver no catálogo
-- do Postgres, então aparece na aba /documentacao, dentro do Metabase (Table
-- Metadata) e no DBeaver — em vez de num markdown que só quem tem acesso ao
-- Git enxerga.
--
-- REGRAS DE MANUTENÇÃO:
--  1. Não edite este arquivo depois de aplicado. Correção = nova migration
--     `..._comentarios_fix_<objeto>.sql` com só as linhas que mudaram.
--     COMMENT ON é idempotente e a última aplicação vence.
--  2. `drop view ... ; create view ...` APAGA os comentários da view e das
--     colunas dela. `create or replace view` preserva. Toda migration que
--     derruba uma view precisa reaplicar os COMMENT ON dela no mesmo arquivo.
--     A barra de cobertura em /documentacao é o detector de quando alguém
--     esquecer.
--  3. Objeto novo nasce com COMMENT ON na migration que o cria.

-- ── Bip (expedição) ────────────────────────────────────────────────────────
comment on table bip_fulfillment_events is
  'Eventos de bipagem da expedição vindos do coletor Bip: cada linha é um pacote bipado numa etapa do fluxo. Alimenta /expedicao.';
comment on table bip_fulfillment_sync_runs is
  'Registro operacional de cada execução do sync do Bip (janela, contagens, erro). Diagnóstico de importação, não serve para relatório.';

-- ── Dimensões ──────────────────────────────────────────────────────────────
comment on table dim_channels is
  'Dimensão de canais de venda: nome cru vindo do ERP e o rótulo padronizado usado nas telas. Use para padronizar nome de canal em relatório.';
comment on table dim_order_status is
  'Dimensão de status de pedido: código do ERP, rótulo legível e se o status conta como venda válida ou cancelamento.';

-- ── Importações (comex) ────────────────────────────────────────────────────
comment on table importacao_ais_sync_runs is
  'Registro operacional de cada varredura AIS (posições de navio). Diagnóstico, não serve para relatório.';
comment on table importacao_faturas is
  'Uma linha por fatura de importação (invoice do fornecedor): valores, incoterm, datas de embarque e chegada, navio e status logístico. Alimenta /importacoes.';
comment on view importacao_faturas_status is
  'Faturas de importação com o status logístico já calculado (em produção, embarcada, em trânsito, chegada, liberada). É a leitura recomendada para acompanhar importação, no lugar da tabela crua.';
comment on table importacao_itens is
  'Itens de cada fatura de importação: SKU, quantidade e custo unitário na moeda de origem. Base do custo de reposição.';
comment on table importacao_navios is
  'Cadastro dos navios rastreados (nome e identificadores AIS/MMSI).';
comment on table importacao_posicoes is
  'Posições AIS dos navios ao longo do tempo (lat/lon, rumo, velocidade). Série temporal: uma linha por leitura, atualizada a cada 6h.';

-- ── Logística ──────────────────────────────────────────────────────────────
comment on table logistica_palete_itens is
  'Itens de um palete. ATENÇÃO: produto e variação são TEXTO LIVRE, deliberadamente desligados do catálogo — o vocabulário do ERP é do marketplace, não da doca. Não junte com SKU esperando casar.';
comment on table logistica_paletes is
  'Paletes montados na expedição, com o código que vai impresso na etiqueta. O texto da etiqueta é congelado na impressão: a etiqueta é um documento, não uma view viva.';

-- ── Mercado Livre ──────────────────────────────────────────────────────────
comment on table mercadolivre_accounts is
  'Contas de vendedor conectadas no Mercado Livre.';
comment on table mercadolivre_connection_runs is
  'Registro operacional das tentativas de conexão/OAuth com o Mercado Livre. Diagnóstico.';
comment on table mercadolivre_inventory_snapshots is
  'Fotografias periódicas do estoque no Mercado Livre. Série histórica: uma linha por SKU por captura.';
comment on table mercadolivre_items is
  'Anúncios do Mercado Livre (MLB): título, preço, status, tipo de anúncio e logística. Um anúncio pode ter várias variações.';
comment on table mercadolivre_notifications is
  'Caixa de entrada das notificações do Mercado Livre (webhooks). Fila de processamento, não fonte analítica.';
comment on table mercadolivre_oauth_states is
  'Estados temporários do fluxo OAuth do Mercado Livre. NÃO É DADO DE NEGÓCIO — não conecte BI aqui.';
comment on table mercadolivre_order_items is
  'Itens de pedido do Mercado Livre, por anúncio e variação.';
comment on table mercadolivre_sales_daily is
  'Vendas diárias agregadas por anúncio no Mercado Livre. Série pronta para relatório — os agregados do app são recalculados a partir daqui, nunca da janela do sync.';
comment on table mercadolivre_sync_runs is
  'Registro operacional das execuções de sync do Mercado Livre. ATENÇÃO: é escrita por mais de uma rotina e não tem coluna de origem — não conclua saúde de uma rotina específica olhando só aqui.';
comment on table mercadolivre_tokens is
  'Tokens OAuth do Mercado Livre (refresh token rotativo). CREDENCIAL — não conecte BI aqui.';
comment on table mercadolivre_transit is
  'Unidades em trânsito para o centro de distribuição do Mercado Livre (Full).';
comment on table mercadolivre_variation_sales_daily is
  'Vendas diárias por variação de anúncio no Mercado Livre. A ruptura acontece por variação: o anúncio segue ativo enquanto uma variação já zerou.';
comment on table mercadolivre_variations is
  'Variações de anúncio do Mercado Livre (cor, tamanho, modelo) com estoque e preço próprios.';

-- ── Olist (ERP — fonte primária de receita) ────────────────────────────────
comment on table olist_invoice_items is
  'Itens das notas fiscais da Olist. ATENÇÃO: total_value carrega o PREÇO DE TABELA do produto, não o valor faturado — para dinheiro use olist_invoices.total_amount. Comparar por aqui já produziu 327 divergências falsas onde havia 25.';
comment on table olist_invoice_sync_runs is
  'Registro operacional das execuções de importação de notas fiscais da Olist. Diagnóstico.';
comment on table olist_invoices is
  'Notas fiscais emitidas pela Olist — a fonte oficial de receita, para TODOS os canais. Uma linha por NF. Use oraculo_fiscal_invoices_valid em vez desta tabela: ela já exclui canceladas e devoluções. Guarda nome e documento do cliente (dado pessoal). raw_json é pesado: evite em agregação.';
comment on table olist_oauth_tokens is
  'Tokens OAuth da API da Olist. CREDENCIAL — não conecte BI aqui.';
comment on table olist_order_item_backfill_queue is
  'Fila de pedidos cujos itens ainda precisam ser buscados na API da Olist. Controle interno do backfill.';
comment on table olist_order_items is
  'Itens dos pedidos da Olist: SKU, quantidade e valor por linha. As UNIDADES vendidas saem daqui. ATENÇÃO: NUNCA conte pedidos aqui (count distinct order_id) — a cobertura de itens oscila por dia e a contagem sai cerca de 3x menor. Pedido se conta em olist_orders.';
comment on table olist_order_items_backfill_errors is
  'Erros do backfill de itens de pedido da Olist. Diagnóstico.';
comment on table olist_order_items_backfill_runs is
  'Registro operacional das execuções do backfill de itens de pedido. Diagnóstico.';
comment on table olist_order_sync_runs is
  'Registro operacional das execuções de importação de pedidos da Olist. Diagnóstico.';
comment on table olist_orders is
  'Pedidos da Olist (ERP) — uma linha por pedido, para todos os canais. É AQUI que se conta pedido. ATENÇÃO: a coluna payload (jsonb) soma mais de 1 GB e guarda o nome do canal e os dados do cliente; agrupar por campo de dentro dela força o detoast da coluna inteira e derruba a consulta. Para recorte por canal use os caches oraculo_*_channel_*.';
comment on table olist_products is
  'Catálogo de produtos do ERP Olist: SKU, descrição, preços e custo. ATENÇÃO: o ERP grava custo 0 em vez de NULL — não use COALESCE(preco_custo_medio, preco_custo). O custo resolvido está em oraculo_sku_unit_cost.';
comment on table olist_stock_items is
  'Saldo de estoque atual por SKU no ERP Olist.';
comment on table olist_stock_snapshots is
  'Fotografias periódicas do estoque do ERP. Série histórica para reconstruir saldo em uma data.';
comment on table olist_stock_sync_runs is
  'Registro operacional das execuções de sync de estoque da Olist. Diagnóstico.';
comment on table olist_stock_sync_state is
  'Cursor retomável da varredura de estoque da Olist (a Edge Function morre por tempo antes de terminar a varredura inteira). Controle interno.';
comment on table olist_sync_runs is
  'Registro operacional consolidado das execuções de sync da Olist. Diagnóstico — alimenta /status.';

-- ── Agenda (uso interno, acesso por linha) ─────────────────────────────────
comment on table oraculo_agenda_subtasks is
  'Checklist colaborativo de uma tarefa da Agenda. USO INTERNO com acesso por linha (RLS): o que você lê depende de quem você é.';
comment on table oraculo_agenda_task_participants is
  'Participantes de uma tarefa da Agenda. USO INTERNO com acesso por linha (RLS).';
comment on table oraculo_agenda_tasks is
  'Tarefas da Agenda do Oráculo. USO INTERNO com acesso por linha (RLS): cada pessoa só enxerga as tarefas de que participa.';

-- ── Camada unificada Oráculo — vendas e canais ─────────────────────────────
comment on view oraculo_channel_sales is
  'Vendas por canal a partir dos pedidos da Olist. Prefira oraculo_channel_sales_unified_cache, que já está materializado e cobre todas as fontes.';
comment on table oraculo_channel_sales_cache is
  'Cache de vendas por canal (só Olist), recalculado por cron. Confira refreshed_at antes de confiar.';
comment on view oraculo_channel_sales_unified is
  'Vendas por canal unificando as fontes. ATENÇÃO: source=olist e source=shopee descrevem A MESMA VENDA — filtre uma fonte, nunca some as duas (dá R$ 12,7 mi contra R$ 8,27 mi reais em 30 dias).';
comment on table oraculo_channel_sales_unified_cache is
  'Cache de vendas por canal e dia, unificado por fonte, recalculado por cron. É a leitura recomendada para volume por canal — evita ler o payload de 1 GB de olist_orders. FILTRE source: olist e shopee são a mesma venda. Confira refreshed_at.';
comment on view oraculo_daily_sales is
  'Receita e pedidos por dia (base Olist), com ticket médio e unidades. Série pronta para gráfico diário.';
comment on table oraculo_daily_sales_cache is
  'Cache da série diária de vendas, recalculado por cron. Confira refreshed_at.';

-- ── Camada fiscal ──────────────────────────────────────────────────────────
comment on view oraculo_fiscal_channel_sales is
  'NÃO USE PARA MIX DE CANAL. Não retorna nenhuma linha de Shopee: reporta R$ 5,09 mi em 180 dias contra R$ 14,6 mi reais. Para mix de canal agrupe oraculo_fiscal_invoices_valid por channel_label.';
comment on view oraculo_fiscal_daily_revenue is
  'Receita faturada por dia de emissão da NF, com contagem de notas e ticket médio. A data é a de emissão (issued_date), não a do pedido.';
comment on table oraculo_fiscal_invoice_order_links is
  'Ligação entre nota fiscal e pedido de origem, usada para atribuir a NF ao canal. Tabela de apoio do motor fiscal.';
comment on view oraculo_fiscal_invoices_valid is
  'NOTAS FISCAIS DE VENDA VÁLIDAS — o número que fecha com a contabilidade. Já exclui canceladas e devoluções, e traz channel_label pronto. É a fonte canônica de faturamento e de mix de canal. Guarda nome e documento do cliente (dado pessoal): use agregado.';
comment on view oraculo_fiscal_latest_snapshots is
  'Último snapshot de cada métrica fiscal capturada de hora em hora. Leitura instantânea para os cards do mês corrente.';
comment on table oraculo_fiscal_snapshots is
  'Histórico de snapshots das métricas fiscais (de hora em hora, retenção de 14 dias). Alimenta as sparklines dos cards.';

-- ── Expedição / fulfillment ────────────────────────────────────────────────
comment on view oraculo_fulfillment_pipeline is
  'Funil de expedição consolidado: do pedido pago até o pacote despachado, por canal e etapa.';

-- ── Parâmetros de margem e imposto ─────────────────────────────────────────
comment on table oraculo_margin_channel_params is
  'Parâmetros de margem por canal (comissão, taxa fixa, frete subsidiado). São DADOS editáveis em /parametros, não código.';
comment on table oraculo_margin_sku_params is
  'Overrides de margem por SKU: custo manual e ajustes que vencem o valor vindo do ERP.';
comment on table oraculo_marketplace_fee_params is
  'Tabela de tarifas dos marketplaces usada no cálculo de margem e na calculadora de preço.';
comment on table oraculo_state_tax_params is
  'Parâmetros de imposto por UF (alíquota interna, MVA, DIFAL) usados na decomposição fiscal.';

-- ── Caches de apoio da Olist ───────────────────────────────────────────────
comment on table oraculo_nf_daily_cache is
  'Cache diário de notas fiscais emitidas. Os 3 dias mais recentes são refrescados de hora em hora (a janela quente continua recebendo NF); dias fechados são imutáveis.';
comment on view oraculo_olist_devolucoes is
  'Notas fiscais de devolução da Olist. O filtro correto é fiscal_origin_type=devolucao — NUNCA fiscal_invoice_type=E, que também arrasta compras e importações e infla 18x.';
comment on table oraculo_olist_order_ref_cache is
  'Cache que extrai do payload de olist_orders as referências de canal e pedido, para que as consultas não precisem detoastar 1 GB de jsonb. Controle interno, mas é o que torna o recorte por canal viável.';
comment on table oraculo_olist_order_ref_cache_days is
  'Controle dos dias já processados pelo cache de referências. Um dia sem nenhuma linha é um dia processado — sem esta tabela o refresh reprocessaria dias vazios para sempre.';
comment on table oraculo_olist_qty_channel_daily_cache is
  'Cache de unidades vendidas por canal e dia (base Olist). Use para volume por canal em vez de agregar os itens ao vivo.';
comment on table oraculo_olist_qty_sku_daily_cache is
  'Cache de unidades vendidas por SKU e dia (base Olist).';

-- ── Camada unificada Oráculo — pedidos, itens e produtos ───────────────────
comment on view oraculo_order_facts is
  'Fatos de pedido normalizados entre canais: uma linha por pedido com valor, status e canal já padronizados.';
comment on view oraculo_order_items_unified is
  'Itens de pedido unificados entre canais, com SKU normalizado. As unidades saem daqui; a contagem de pedidos, não.';
comment on view oraculo_orders_unified is
  'Pedidos unificados entre canais. ATENÇÃO: source=olist e source=shopee são a mesma venda — filtre uma fonte antes de somar.';
comment on view oraculo_product_effective_cost is
  'Custo efetivo do produto, já expandindo kits pelos componentes. Base de oraculo_sku_unit_cost.';
comment on view oraculo_products_unified is
  'Catálogo de produtos unificado entre canais, com o SKU de cada marketplace mapeado para o SKU do ERP.';

-- ── Devoluções ─────────────────────────────────────────────────────────────
comment on table oraculo_return_reason_map is
  'De-para dos motivos de devolução de cada canal para um vocabulário único. São DADOS, não código: motivo novo se cadastra aqui.';
comment on table oraculo_returns is
  'Camada canônica de devoluções — Shopee e Mercado Livre por API, TikTok por upload de planilha. ATENÇÃO: devolução recusada NÃO é perda (37% das linhas do TikTok) e refund_only nunca gera NF de devolução. Guarda dado do comprador: use agregado.';
comment on view oraculo_returns_reconciled is
  'Devoluções conciliadas com a NF de venda e a NF de devolução. A NF de devolução vem com pedido zerado, então a ligação é heurística (CPF + SKU + 90 dias) e carrega um match_score — leia o score antes de tratar a ligação como certa.';
comment on table oraculo_returns_upload_batches is
  'Lotes de devolução importados por planilha (TikTok), com quem subiu e quando.';

-- ── RPA Afiliados (dado pessoal de terceiros) ──────────────────────────────
comment on table oraculo_rpa_batches is
  'Lotes mensais do relatório de afiliados da Shopee. DADO PESSOAL DE TERCEIROS (CPF, endereço, data de nascimento de centenas de afiliados): acesso restrito a service_role de propósito. NÃO EXPONHA NO BI.';
comment on table oraculo_rpa_issuers is
  'Cadastro dos afiliados emissores de recibo. DADO PESSOAL DE TERCEIROS — acesso restrito. NÃO EXPONHA NO BI.';
comment on table oraculo_rpa_items is
  'Linhas do recibo de cada afiliado, com retenções congeladas na linha (um recibo é documento, não view viva). DADO PESSOAL DE TERCEIROS — acesso restrito. NÃO EXPONHA NO BI.';

-- ── Curvas (materialized views) ────────────────────────────────────────────
comment on materialized view oraculo_sales_curve_cache is
  'Curva ABC de saída materializada. Acesso restrito a service_role: pelo app leia via a função oraculo_sales_curve().';
comment on materialized view oraculo_stock_coverage_curve_cache is
  'Curva de cobertura de estoque materializada. Acesso restrito a service_role: pelo app leia via a função oraculo_stock_coverage_curve().';

-- ── Shopee (camada Oráculo) ────────────────────────────────────────────────
comment on view oraculo_shopee_coverage_check is
  'Conferência de cobertura da Shopee: compara o que a API trouxe com o que a NF registra. Ferramenta de auditoria.';
comment on table oraculo_shopee_precos_sales_daily is
  'Vendas diárias por SKU da Shopee usadas na análise de preço.';
comment on table oraculo_shopee_price_product_cache is
  'Cache da análise de preço por produto da Shopee (preço praticado, concorrência, elasticidade). Alimenta /shopee/precos.';
comment on table oraculo_shopee_price_product_runs is
  'Registro operacional das execuções da coleta de preços da Shopee. Diagnóstico.';
comment on view oraculo_shopee_take_rate_shop_daily is
  'Take rate diário por loja Shopee: quanto do bruto ficou com o marketplace (comissão, frete, taxas).';
comment on table oraculo_shopee_take_rate_shop_daily_cache is
  'Cache do take rate diário por loja Shopee. Confira refreshed_at.';
comment on view oraculo_shopee_take_rate_sku_daily is
  'Take rate diário por SKU na Shopee.';
comment on table oraculo_shopee_take_rate_sku_daily_cache is
  'Cache do take rate diário por SKU na Shopee. Confira refreshed_at.';

-- ── SKU: mapa, estoque, vendas e margem ────────────────────────────────────
comment on view oraculo_sku_channel_map is
  'De-para entre o SKU de cada marketplace e o SKU do ERP. ATENÇÃO: SKU de marketplace raramente casa por texto com o SKU da NF (só 5 de 501 na Shopee, 21 de 108 no TikTok) — use este mapa, não uma tradução própria.';
comment on table oraculo_sku_channel_map_cache is
  'Cache do de-para de SKU por canal. Confira refreshed_at.';
comment on view oraculo_sku_current is
  'Situação atual de cada SKU na base Olist: estoque, giro e última venda.';
comment on view oraculo_sku_current_unified is
  'Situação atual de cada SKU unificando os canais: estoque, giro, receita e sinal de ruptura.';
comment on view oraculo_sku_current_unified_base is
  'View base de oraculo_sku_current_unified. Camada interna — leia a view unificada ou o cache.';
comment on table oraculo_sku_current_unified_cache is
  'Cache da situação atual por SKU. É a leitura recomendada (a view ao vivo é pesada). CONFIRA refreshed_at: este cache já congelou por 45 dias servindo dados velhos sem nenhum erro.';
comment on view oraculo_sku_margin_30d is
  'Margem operacional por SKU nos últimos 30 dias. ATENÇÃO: não separa canal, então um pedido B2B fora de marketplace derruba o preço médio e reporta margem que nunca aconteceu. Para margem confiável use a função oraculo_fiscal_sku_margin().';
comment on view oraculo_sku_sales is
  'Vendas por SKU na base Olist.';
comment on view oraculo_sku_sales_unified is
  'Vendas por SKU unificando os canais. Filtre a fonte antes de somar.';
comment on view oraculo_sku_unit_cost is
  'LIVRO DE CUSTO UNITÁRIO — a fonte canônica de custo por SKU. Resolve override manual > custo do ERP (ignorando R$ 0, que a maioria dos SKUs tem) > custo efetivo do kit pelos componentes. Nunca reimplemente resolução de custo: quem reimplementou reportou 80% da receita como sem custo quando só R$ 15 mil realmente faltavam.';

-- ── Estoque / ruptura ──────────────────────────────────────────────────────
comment on view oraculo_stock_watchlist is
  'Lista de atenção de estoque na base Olist: o que está prestes a romper.';
comment on view oraculo_stock_watchlist_unified is
  'Lista de atenção de estoque unificada entre canais, com dias até a ruptura e sinal. A velocidade de venda considera dias COM estoque, não dias corridos.';
comment on view oraculo_stock_watchlist_unified_base is
  'View base da lista de atenção de estoque. Camada interna — leia a view unificada ou o cache.';
comment on table oraculo_stock_watchlist_unified_cache is
  'Cache da lista de atenção de estoque. Confira refreshed_at.';

-- ── Shopee (dado bruto) ────────────────────────────────────────────────────
comment on table shopee_ads_campaigns is
  'Campanhas de Shopee Ads por loja.';
comment on table shopee_ads_collection_runs is
  'Registro operacional da coleta de dados de Shopee Ads. Diagnóstico.';
comment on table shopee_ads_daily is
  'Métricas diárias de Shopee Ads por campanha: investimento, cliques, conversões e receita atribuída.';
comment on table shopee_ads_report_messages is
  'Mensagens geradas pelo relatório de Ads (texto entregue ao time).';
comment on table shopee_ads_report_runs is
  'Registro operacional das execuções do relatório de Ads. ATENÇÃO: um run interrompido fica em analyzing para sempre e bloqueia os disparos seguintes.';
comment on table shopee_app_config is
  'Configuração dos apps parceiros da Shopee (uma loja, um app). CREDENCIAL — não conecte BI aqui.';
comment on table shopee_fulfillment_packages is
  'Pacotes de expedição da Shopee, com rastreio e etapa logística.';
comment on table shopee_order_escrow is
  'Detalhamento financeiro do repasse da Shopee por pedido (escrow): comissões, taxas e valor líquido. DADO PESSOAL/FINANCEIRO — acesso restrito a service_role de propósito. NÃO EXPONHA NO BI.';
comment on table shopee_order_items is
  'Itens dos pedidos da Shopee, por item e modelo (variação).';
comment on table shopee_orders is
  'Pedidos da Shopee vindos da API direta das 4 lojas. ATENÇÃO: esta é a MESMA venda que já está em olist_orders/olist_invoices, com outro nome de SKU — serve para conferência, não para somar com a Olist. Guarda dados do comprador.';
comment on table shopee_product_snapshots is
  'Fotografias periódicas dos produtos da Shopee (preço e estoque ao longo do tempo).';
comment on table shopee_products is
  'Catálogo de produtos da Shopee por loja: item, modelo, preço e estoque.';
comment on table shopee_sales_daily is
  'Vendas diárias agregadas por SKU na Shopee. Os agregados são recalculados a partir desta série, nunca da janela do sync.';
comment on table shopee_sbs_inventory is
  'Estoque no fulfillment da Shopee (SBS): saldo vendável, reservado e em trânsito.';
comment on table shopee_sbs_snapshots is
  'Fotografias periódicas do estoque SBS da Shopee.';
comment on table shopee_shops is
  'As 4 lojas Shopee conectadas. Cada loja tem seu próprio app parceiro: assinatura errada aparece como token inválido.';
comment on table shopee_sync_runs is
  'Registro operacional das execuções de sync da Shopee, marcadas por origem. Diagnóstico — alimenta /status.';
comment on table shopee_tokens is
  'Tokens de acesso da Shopee por loja. CREDENCIAL — não conecte BI aqui. Só a rotina shopee-sync renova; as demais apenas leem.';
