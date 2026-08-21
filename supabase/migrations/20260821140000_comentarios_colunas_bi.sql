-- Onda 1 de comentários de COLUNA: os objetos que o BI realmente consome.
--
-- Cobre os 16 objetos que aparecem nas receitas de SQL e nas armadilhas. As
-- demais colunas do schema entram em ondas por domínio; a barra de cobertura
-- em /documentacao mostra o que falta.
--
-- Mesmas regras de manutenção da migration 20260821130000: não edite este
-- arquivo depois de aplicado (corrija em migration nova) e lembre que
-- `drop view` apaga os comentários das colunas da view.

-- ── dim_channels ───────────────────────────────────────────────────────────
comment on column dim_channels.id is 'Chave da dimensão: fonte + id do canal na origem.';
comment on column dim_channels.source is 'Sistema de origem do canal (olist, shopee, mercadolivre).';
comment on column dim_channels.source_id is 'Id do canal no sistema de origem.';
comment on column dim_channels.source_name is 'Nome cru do canal como veio da origem — costuma ter grafias inconsistentes.';
comment on column dim_channels.display_name is 'Nome padronizado do canal. É este que deve aparecer em relatório.';
comment on column dim_channels.channel_group is 'Agrupamento do canal (marketplace, próprio, B2B) para recortes mais largos.';
comment on column dim_channels.active is 'Se o canal segue ativo. Canal inativo ainda tem histórico de venda.';
comment on column dim_channels.first_seen_at is 'Primeira vez que este canal apareceu nos dados.';
comment on column dim_channels.last_seen_at is 'Última vez que este canal apareceu nos dados.';
comment on column dim_channels.meta is 'Metadados brutos do canal (jsonb).';
comment on column dim_channels.synced_at is 'Quando esta linha foi sincronizada pela última vez.';

-- ── dim_order_status ───────────────────────────────────────────────────────
comment on column dim_order_status.id is 'Chave da dimensão: fonte + código do status.';
comment on column dim_order_status.source is 'Sistema de origem do status.';
comment on column dim_order_status.code is 'Código do status como o sistema de origem grava.';
comment on column dim_order_status.label is 'Rótulo legível do status. Use este em relatório.';
comment on column dim_order_status.funnel_stage is 'Etapa do funil a que o status pertence (pago, separado, enviado, entregue).';
comment on column dim_order_status.sort_order is 'Ordem do status no funil, para ordenar gráficos corretamente.';
comment on column dim_order_status.is_canceled is 'Se o status representa cancelamento. Filtre por aqui em vez de comparar texto.';
comment on column dim_order_status.is_closed is 'Se o status é terminal (o pedido não muda mais).';
comment on column dim_order_status.meta is 'Metadados brutos do status (jsonb).';
comment on column dim_order_status.synced_at is 'Quando esta linha foi sincronizada pela última vez.';

-- ── olist_orders ───────────────────────────────────────────────────────────
comment on column olist_orders.id is 'Id do pedido na Olist. Chave primária — é aqui que se conta pedido.';
comment on column olist_orders.numero_pedido is 'Número do pedido exibido no ERP.';
comment on column olist_orders.situacao is 'Situação do pedido no ERP. Cruze com dim_order_status para saber se conta como venda.';
comment on column olist_orders.data_criacao is 'Data e hora de criação do pedido. É a data de VENDA — a data fiscal é a de emissão da NF e pode cair em outro mês.';
comment on column olist_orders.data_atualizacao is 'Última atualização do pedido no ERP.';
comment on column olist_orders.cliente is 'Dados do cliente (jsonb). DADO PESSOAL: nome, documento e endereço. Não exponha linha a linha.';
comment on column olist_orders.transportador is 'Dados da transportadora (jsonb).';
comment on column olist_orders.payload is 'Resposta bruta da API (jsonb). ATENÇÃO: soma mais de 1 GB. O nome do canal só existe aqui dentro (payload.ecommerce.nome), e agrupar por ele força o detoast da coluna inteira — 5,0s contra 1,4s. Para recorte por canal use oraculo_channel_sales_unified_cache ou oraculo_olist_order_ref_cache.';
comment on column olist_orders.synced_at is 'Quando este pedido foi sincronizado pela última vez.';

-- ── olist_order_items ──────────────────────────────────────────────────────
comment on column olist_order_items.id is 'Chave da linha de item.';
comment on column olist_order_items.order_id is 'Pedido a que este item pertence (olist_orders.id). NÃO conte pedidos distintos aqui: a cobertura de itens oscila por dia e a contagem sai cerca de 3x menor.';
comment on column olist_order_items.line_number is 'Número da linha dentro do pedido.';
comment on column olist_order_items.produto_id is 'Id do produto no ERP.';
comment on column olist_order_items.sku is 'SKU do produto no ERP. Para casar com SKU de marketplace use oraculo_sku_channel_map.';
comment on column olist_order_items.tipo is 'Tipo do item no ERP. K indica kit — kit tem custo pelos componentes, não próprio.';
comment on column olist_order_items.descricao is 'Descrição do item como gravada no pedido.';
comment on column olist_order_items.quantidade is 'Unidades vendidas nesta linha. É daqui que saem as UNIDADES (sempre um piso, pela cobertura parcial de itens).';
comment on column olist_order_items.valor_unitario is 'Valor unitário praticado nesta linha, em R$.';
comment on column olist_order_items.valor_total is 'Valor total da linha, em R$ (quantidade x valor unitário).';
comment on column olist_order_items.info_adicional is 'Informação adicional da linha, texto livre do ERP.';
comment on column olist_order_items.order_data_criacao is 'Data de criação do pedido, repetida na linha para permitir filtro por período sem juntar com olist_orders.';
comment on column olist_order_items.payload is 'Resposta bruta do item (jsonb). Pesado: evite em agregação.';
comment on column olist_order_items.synced_at is 'Quando este item foi sincronizado pela última vez.';

-- ── olist_invoices ─────────────────────────────────────────────────────────
comment on column olist_invoices.id is 'Id da nota fiscal na Olist.';
comment on column olist_invoices.invoice_number is 'Número da NF.';
comment on column olist_invoices.invoice_series is 'Série da NF.';
comment on column olist_invoices.emission_date is 'Data e hora de emissão da NF. É a DATA FISCAL — pode cair em mês diferente do pedido.';
comment on column olist_invoices.cancellation_date is 'Data de cancelamento, quando houve. NF cancelada não é receita.';
comment on column olist_invoices.status is 'Status da NF no ERP.';
comment on column olist_invoices.status_label is 'Rótulo legível do status da NF.';
comment on column olist_invoices.client_name is 'Nome do cliente. DADO PESSOAL — use agregado.';
comment on column olist_invoices.client_document is 'CPF/CNPJ do cliente. DADO PESSOAL — use agregado.';
comment on column olist_invoices.uf is 'UF de destino. Base do cálculo de DIFAL.';
comment on column olist_invoices.total_amount is 'VALOR TOTAL DA NOTA, em R$. É por esta coluna que se compara dinheiro — nunca pela soma de olist_invoice_items.total_value, que carrega preço de tabela.';
comment on column olist_invoices.channel_name is 'Canal de venda gravado na NF.';
comment on column olist_invoices.integration_name is 'Nome da integração que originou a NF.';
comment on column olist_invoices.marketplace_name is 'Nome do marketplace gravado na NF.';
comment on column olist_invoices.order_id is 'Pedido de origem. ATENÇÃO: em NF de devolução vem zerado — a ligação com a venda é heurística.';
comment on column olist_invoices.order_number is 'Número do pedido de origem. Também zerado em NF de devolução.';
comment on column olist_invoices.access_key is 'Chave de acesso da NF-e (44 dígitos).';
comment on column olist_invoices.raw_json is 'Resposta bruta da API (jsonb). Pesado: evite em agregação.';
comment on column olist_invoices.synced_at is 'Quando esta NF foi sincronizada pela última vez.';
comment on column olist_invoices.fiscal_invoice_type is 'Tipo fiscal do documento (S=saída, E=entrada). NÃO use E para achar devolução: o tipo também arrasta compras e importações e infla 18x. Use fiscal_origin_type.';
comment on column olist_invoices.fiscal_origin_type is 'Natureza da operação classificada: venda, devolucao, compra, importacao. É POR AQUI que se filtra devolução.';
comment on column olist_invoices.fiscal_amount is 'Valor fiscal considerado no motor de margem, em R$.';
comment on column olist_invoices.fiscal_channel_label is 'Canal padronizado da NF, já normalizado para relatório.';

-- ── olist_invoice_items ────────────────────────────────────────────────────
comment on column olist_invoice_items.id is 'Chave da linha do item da NF.';
comment on column olist_invoice_items.invoice_id is 'NF a que este item pertence (olist_invoices.id).';
comment on column olist_invoice_items.line_number is 'Número da linha dentro da NF.';
comment on column olist_invoice_items.product_id is 'Id do produto no ERP.';
comment on column olist_invoice_items.sku is 'SKU do produto na NF. É o SKU do ERP, não o do marketplace.';
comment on column olist_invoice_items.description is 'Descrição do produto na NF.';
comment on column olist_invoice_items.quantity is 'Unidades desta linha da NF.';
comment on column olist_invoice_items.unit_value is 'Valor unitário na linha — é PREÇO DE TABELA do produto, não o efetivamente faturado.';
comment on column olist_invoice_items.total_value is 'Total da linha. NÃO SOME PARA COMPARAR DINHEIRO: carrega preço de tabela e produziu razão mediana de 2,003 contra o valor real. Use olist_invoices.total_amount.';
comment on column olist_invoice_items.raw_json is 'Resposta bruta do item (jsonb).';
comment on column olist_invoice_items.synced_at is 'Quando este item foi sincronizado pela última vez.';
comment on column olist_invoice_items.invoice_number is 'Número da NF, repetido na linha para facilitar filtro.';

-- ── olist_products ─────────────────────────────────────────────────────────
comment on column olist_products.id is 'Id do produto no ERP Olist.';
comment on column olist_products.sku is 'SKU do produto no ERP. É a chave de junção com os itens de pedido e de NF.';
comment on column olist_products.nome is 'Nome do produto no ERP. ATENÇÃO: é o título do anúncio do marketplace, não um nome físico — não sirva para etiqueta de doca.';
comment on column olist_products.tipo is 'Tipo do produto. K indica kit: o custo vem dos componentes, não desta linha.';
comment on column olist_products.situacao is 'Situação do produto no ERP (ativo, inativo).';
comment on column olist_products.categoria_id is 'Id da categoria no ERP.';
comment on column olist_products.categoria_nome is 'Nome da categoria.';
comment on column olist_products.marca_id is 'Id da marca no ERP.';
comment on column olist_products.marca_nome is 'Nome da marca.';
comment on column olist_products.gtin is 'Código de barras (GTIN/EAN).';
comment on column olist_products.preco is 'Preço de venda cadastrado, em R$.';
comment on column olist_products.preco_promocional is 'Preço promocional cadastrado, em R$.';
comment on column olist_products.preco_custo is 'Custo cadastrado, em R$. ATENÇÃO: o ERP grava 0, não NULL, na maioria dos SKUs — COALESCE devolve zero em vez de cair para o próximo. Use oraculo_sku_unit_cost.';
comment on column olist_products.preco_custo_medio is 'Custo médio cadastrado, em R$. Mesma armadilha do zero em vez de nulo.';
comment on column olist_products.saldo is 'Saldo total em estoque.';
comment on column olist_products.reservado is 'Unidades reservadas por pedidos em aberto.';
comment on column olist_products.disponivel is 'Unidades disponíveis para venda (saldo menos reservado).';
comment on column olist_products.active is 'Se o produto está ativo no ERP.';
comment on column olist_products.payload is 'Resposta bruta da API (jsonb).';
comment on column olist_products.synced_at is 'Quando este produto foi sincronizado pela última vez.';

-- ── oraculo_sku_unit_cost (livro de custo canônico) ────────────────────────
comment on column oraculo_sku_unit_cost.sku is 'SKU do ERP.';
comment on column oraculo_sku_unit_cost.unit_cost is 'Custo unitário LÍQUIDO em R$, já descontados os créditos de imposto conforme a origem. É este que entra no cálculo de margem.';
comment on column oraculo_sku_unit_cost.cost_source is 'Qual regra resolveu o custo: override manual, custo do ERP ou custo efetivo do kit pelos componentes. Leia antes de questionar um custo.';
comment on column oraculo_sku_unit_cost.unit_cost_gross is 'Custo unitário BRUTO em R$, antes dos créditos de imposto.';

-- ── oraculo_sku_current_unified ────────────────────────────────────────────
comment on column oraculo_sku_current_unified.source is 'Fonte do dado (olist, shopee, mercadolivre). FILTRE: olist e shopee descrevem a mesma venda.';
comment on column oraculo_sku_current_unified.sku is 'SKU já normalizado para o vocabulário do ERP.';
comment on column oraculo_sku_current_unified.product_name is 'Nome do produto conforme a fonte.';
comment on column oraculo_sku_current_unified.status_label is 'Situação do SKU na fonte.';
comment on column oraculo_sku_current_unified.units_30d is 'Unidades vendidas nos últimos 30 dias.';
comment on column oraculo_sku_current_unified.revenue_30d is 'Receita dos últimos 30 dias, em R$.';
comment on column oraculo_sku_current_unified.units_prev_30d is 'Unidades nos 30 dias anteriores, para comparação.';
comment on column oraculo_sku_current_unified.revenue_prev_30d is 'Receita nos 30 dias anteriores, em R$.';
comment on column oraculo_sku_current_unified.revenue_change_pct is 'Variação percentual da receita entre os dois períodos de 30 dias.';
comment on column oraculo_sku_current_unified.available_stock is 'Unidades disponíveis para venda agora.';
comment on column oraculo_sku_current_unified.stock_balance is 'Saldo total em estoque, incluindo reservado.';
comment on column oraculo_sku_current_unified.days_until_stockout is 'Dias estimados até zerar, pela velocidade de venda. A velocidade considera dias COM estoque, não dias corridos.';
comment on column oraculo_sku_current_unified.last_sale_at is 'Data da última venda registrada. Nulo = sem venda no histórico sincronizado.';

-- ── oraculo_stock_watchlist_unified ────────────────────────────────────────
comment on column oraculo_stock_watchlist_unified.source is 'Fonte do dado. FILTRE antes de somar.';
comment on column oraculo_stock_watchlist_unified.sku is 'SKU normalizado.';
comment on column oraculo_stock_watchlist_unified.product_name is 'Nome do produto conforme a fonte.';
comment on column oraculo_stock_watchlist_unified.status_label is 'Situação do SKU na fonte.';
comment on column oraculo_stock_watchlist_unified.available_stock is 'Unidades disponíveis para venda agora.';
comment on column oraculo_stock_watchlist_unified.stock_balance is 'Saldo total em estoque, incluindo reservado.';
comment on column oraculo_stock_watchlist_unified.units_30d is 'Unidades vendidas nos últimos 30 dias.';
comment on column oraculo_stock_watchlist_unified.revenue_30d is 'Receita dos últimos 30 dias, em R$ — é a base do cálculo de ruptura em R$/dia.';
comment on column oraculo_stock_watchlist_unified.days_until_stockout is 'Dias estimados até zerar. Nulo = sem giro suficiente para estimar.';
comment on column oraculo_stock_watchlist_unified.last_sale_at is 'Data da última venda registrada.';
comment on column oraculo_stock_watchlist_unified.stock_signal is 'Sinal de atenção (crítico, atenção, saudável) derivado dos dias até a ruptura.';

-- ── oraculo_products_unified ───────────────────────────────────────────────
comment on column oraculo_products_unified.source is 'Fonte do catálogo (olist, shopee, mercadolivre).';
comment on column oraculo_products_unified.product_id is 'Id do produto na fonte.';
comment on column oraculo_products_unified.sku is 'SKU normalizado para o vocabulário do ERP.';
comment on column oraculo_products_unified.product_name is 'Nome do produto conforme a fonte.';
comment on column oraculo_products_unified.status_label is 'Situação do produto na fonte.';
comment on column oraculo_products_unified.stock_available is 'Unidades disponíveis para venda na fonte.';
comment on column oraculo_products_unified.stock_total is 'Saldo total em estoque na fonte.';
comment on column oraculo_products_unified.raw_json is 'Payload bruto do produto (jsonb).';

-- ── oraculo_returns (camada canônica de devoluções) ────────────────────────
comment on column oraculo_returns.channel is 'Canal onde a devolução aconteceu (shopee, mercadolivre, tiktok).';
comment on column oraculo_returns.return_id is 'Id da devolução no canal de origem. Junto com channel forma a chave.';
comment on column oraculo_returns.account_ref is 'Conta/loja do canal a que a devolução pertence.';
comment on column oraculo_returns.order_ref is 'Pedido de origem no canal.';
comment on column oraculo_returns.sku_channel is 'SKU como o marketplace o nomeia.';
comment on column oraculo_returns.sku_olist is 'SKU traduzido para o vocabulário do ERP. Pode ser nulo quando a tradução não foi possível.';
comment on column oraculo_returns.product_name is 'Nome do produto devolvido.';
comment on column oraculo_returns.qty is 'Unidades devolvidas.';
comment on column oraculo_returns.qty_assumed is 'Verdadeiro quando a quantidade foi assumida como 1 por falta de informação do canal. Não trate como medida.';
comment on column oraculo_returns.opened_at is 'Quando a devolução foi aberta.';
comment on column oraculo_returns.closed_at is 'Quando a devolução foi encerrada.';
comment on column oraculo_returns.status is 'Status da devolução no canal.';
comment on column oraculo_returns.return_type is 'Tipo: return_refund (mercadoria volta) ou refund_only (só estorno). refund_only NUNCA gera NF de devolução — não sinalize NF faltando nesses casos.';
comment on column oraculo_returns.reason_raw is 'Motivo como o canal escreveu, sem tratamento.';
comment on column oraculo_returns.reason_group is 'Motivo padronizado pelo de-para oraculo_return_reason_map. Use este para agrupar.';
comment on column oraculo_returns.refund_amount is 'Valor estornado em R$ quando o canal informa. ATENÇÃO: quando o canal não informa, este campo NÃO é preenchido com estimativa — confira a origem antes de somar.';
comment on column oraculo_returns.order_amount is 'Valor total do pedido de origem, em R$. Não é o valor da devolução: numa devolução parcial ele superestima.';
comment on column oraculo_returns.buyer_note is 'Comentário do comprador. DADO PESSOAL em texto livre — não publique.';
comment on column oraculo_returns.source is 'Rotina que gravou a linha (api ou upload).';
comment on column oraculo_returns.upload_batch_id is 'Lote de upload, quando a devolução veio por planilha.';
comment on column oraculo_returns.raw is 'Payload bruto da devolução (jsonb).';
comment on column oraculo_returns.synced_at is 'Quando esta linha foi sincronizada pela última vez.';
