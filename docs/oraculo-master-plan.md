# Oraculo Master Plan

## Objetivo

Construir o `Oraculo` como uma camada operacional e analítica sobre os dados da Olist, com base canônica no Supabase, interface web na Vercel/Next.js e documentação persistente para que o projeto não perca contexto entre sessões, contas ou agentes.

O sistema desejado não é apenas um dashboard. Ele precisa:

- centralizar dados comerciais e operacionais
- tratar produto como ativo
- medir operação por canal, SKU, período e estado
- identificar ruptura, queda, ascensão e estoque parado
- suportar evolução futura para alertas e camada de IA

---

## Estado executivo em 2026-06-25

O projeto saiu da fase de prova isolada da Olist e entrou na fase de consolidação multi-canal, reconciliação de métricas e parametrização operacional.

O foco definido pelo usuário agora é:

- entendimento rápido e prático de ROI por produto;
- curva de saída e de não saída de produto;
- margem por produto;
- alertas de margem conforme parâmetros configuráveis no frontend;
- visão confiável por SKU, canal, estoque, ruptura e dias sem venda;
- dados da Olist e marketplaces cruzados no mesmo banco.
- operação utilizável em desktop e mobile.

Decisão importante: antes de avançar em ROI/margem, o projeto precisa ter métricas auditáveis. Foi identificado que parte dos números do dashboard estava semanticamente incorreta: a tela chamava de `NFs emitidas` e `receita confirmada`, mas a métrica vinha de pedidos criados/status, não da camada fiscal completa de notas fiscais.

Nova premissa oficial definida em `2026-06-22`:

- Venda oficial = NF faturada de saida.
- Receita oficial = valor total das NFs emitidas/autorizadas.
- Produto vendido para margem, ROI e ROAS = item vinculado a NF emitida.

A tela `Notas Fiscais` da Olist mostrou, para `2026-06-01` a `2026-06-19`, `71.197` NFs emitidas e `R$ 5.243.629,96`. O Oraculo encontrou apenas `656` pedidos com `payload.dataFaturamento` e `R$ 42.968,72`, provando que `dataFaturamento` em `olist_orders` nao captura a tela fiscal.

Por isso, foi criada uma camada de contrato e auditoria:

- [docs/metric-contract.md](/Users/julianocalil/oraculo/docs/metric-contract.md)
- [docs/nf-faturada-audit.md](/Users/julianocalil/oraculo/docs/nf-faturada-audit.md)
- [scripts/audit-oraculo-metrics.js](/Users/julianocalil/oraculo/scripts/audit-oraculo-metrics.js)
- [scripts/audit-olist-invoices.js](/Users/julianocalil/oraculo/scripts/audit-olist-invoices.js)
- função Supabase `oraculo_reconciliation_snapshot`

Resultado da auditoria para `2026-06-01` a `2026-06-30`:

- Olist por data de criação do pedido: `69.501` pedidos
- Olist cancelados: `554`
- Olist pendentes: `18`
- Receita operacional Olist preferencial: `R$ 5.097.896,89` bruta e cerca de `R$ 5.060.984,62` líquida operacional no cache de canais
- Olist com `dataFaturamento` fiscal preenchida no período: `656` NFs
- Receita por `dataFaturamento` fiscal preenchida: `R$ 42.968,72`
- Shopee Donacor importada no cache de canais: `9.873` pedidos, `1.106` cancelados, `R$ 601.481,08` líquido operacional

Leitura correta anterior, antes da nova premissa fiscal:

- O dashboard principal deve falar em `receita operacional` e `vendas confirmadas`, não em `NF fiscal`, enquanto `dataFaturamento` estiver incompleto.
- A visão fiscal por NF só deve ser usada como auditoria específica, não como KPI principal da operação.
- ROI e margem ainda não podem ser exibidos como prontos porque faltam custo, impostos, tarifas, frete subsidiado e parâmetros por canal/produto.

Leitura correta atual:

- A auditoria fiscal bateu com a tela da Olist dentro da tolerancia aprovada.
- A fonte oficial de venda e receita passa a ser `olist_invoices`, nao `olist_orders.payload.dataFaturamento`.
- O dashboard recebeu uma secao fiscal oficial isolada, sem migrar a tela inteira de uma vez.
- ROI, margem, ROAS e SKU fiscal so devem migrar depois que `olist_invoice_items` tiver cobertura auditada.

Regra fiscal oficial validada:

- `status in (6,7)`;
- excluir `tipo = E`;
- excluir `raw_json.origem.tipo = devolucao`;
- data fiscal = data de emissao da NF;
- receita oficial = valor fiscal validado da NF.

Resultado aceito para `2026-06-01` a `2026-06-19`:

- Tela Olist: `71.197` NFs / `R$ 5.243.629,96`;
- Supabase filtrado: `71.198` NFs / `R$ 5.243.715,76`;
- diferenca: `+1` NF / `+R$ 85,80`.

Objetos oficiais criados:

- `oraculo_fiscal_invoices_valid`;
- `oraculo_fiscal_daily_revenue`;
- `oraculo_fiscal_channel_sales`;
- `oraculo_fiscal_metrics`;
- `oraculo_fiscal_channel_metrics`;
- [scripts/audit-oraculo-fiscal-metrics.js](/Users/julianocalil/oraculo/scripts/audit-oraculo-fiscal-metrics.js).

Commit de referência:

- `a200b0b Add metric reconciliation and channel cache`

Entregas mais recentes:

- Login com Supabase Auth, tela `/login` e controle de usuários em `/usuarios`.
- Deploy de produção na Vercel com domínio `https://oraculo.oliverhome.com.br`.
- Dashboard corrigido para respeitar filtro de data em receita por canal/fonte, SKU por receita, ranking rápido e ruptura.
- Cache `oraculo_channel_sales_unified_cache` recalculado sob demanda por janela/dia quando o período selecionado ainda não existe no cache.
- Função `oraculo_sku_period_rank_unified` otimizada para ler itens vendidos do período em vez de depender de views pesadas.
- Tela `/parametros` consolidada para entrada manual de parâmetros por canal, SKU e UF.
- Tabela `oraculo_state_tax_params` criada para ICMS/FCP/DIFAL/taxa efetiva por estado, fonte, operação e vigência.
- Sincronização Olist transferida para Supabase `pg_cron`, com ciclos horários incrementais.
- Edge Functions de Olist ajustadas para reduzir chamadas desnecessárias de detalhe e lidar melhor com limite `429`.
- Layout mobile-friendly publicado: navegação horizontal no topo, cards em uma coluna, tabelas com rolagem controlada, formulários responsivos.
- Migração criada para `olist_invoices`, `olist_invoice_items` e `olist_invoice_sync_runs`.
- Script fiscal criado para auditar endpoint de NFs e comparar Supabase vs tela manual da Olist.
- Sync incremental de NFs implementado em `scripts/sync-olist-invoices.js` e executado para `2026-06-01` a `2026-06-19`, carregando `72.112` NFs da API `notas`.
- Sync incremental de itens fiscais implementado em `scripts/sync-olist-invoice-items.js`; teste inicial confirmou que `notas/{id}` traz `itens`.
- Reconciliacao fiscal validada: a regra `status in (6,7)`, sem `tipo = E` e sem devolucao retorna `71.198` NFs e `R$ 5.243.715,76`, contra `71.197` e `R$ 5.243.629,96` na tela Olist.
- Secao fiscal oficial adicionada ao dashboard com NFs emitidas, receita faturada, ticket medio faturado, canceladas e devolucoes excluidas.
- `oraculo_fiscal_sku_sales` ainda nao foi criada porque apenas `25` NFs validas tinham itens hidratados contra `71.198` NFs fiscais validas no periodo auditado.
- Auditoria de cobertura de itens fiscais criada em `scripts/audit-olist-invoice-items-coverage.js` e documentada em `docs/fiscal-sku-items-coverage.md`.
- Resultado da cobertura de itens para `2026-06-01` a `2026-06-19`: item fiscal puro cobre `0,04%` das NFs; NF vinculada a pedido cobre `99,77%`; NF vinculada a pedido com itens em `olist_order_items` cobre apenas `0,97%` das NFs e `0,87%` da receita.
- Proxima etapa tecnica: backfill controlado de `olist_order_items` para os pedidos vinculados por `payload.ecommerce.numeroPedidoEcommerce`. So depois disso criar a view candidata `fiscal_sku_sales_by_order_link`.

### Checkpoint atual

Entregue e validado:

- camada fiscal oficial de cabecalho;
- reconciliacao da tela Olist com tolerancia aprovada;
- dashboard fiscal separado da camada operacional;
- auditoria de campos monetarios, status, tipos e devolucoes;
- auditoria de cobertura de itens fiscais;
- vinculo NF -> pedido validado por `payload.ecommerce.numeroPedidoEcommerce`;
- documentacao central e memoria Obsidian atualizadas.

Numeros de referencia para `2026-06-01` a `2026-06-19`:

- NFs fiscais validas: `71.198`;
- receita fiscal: `R$ 5.243.715,76`;
- NFs vinculadas a pedido: `71.032` (`99,77%`);
- NFs com itens fiscais puros: `25` (`0,04%`);
- NFs com itens via pedido: `690` (`0,97%`);
- receita fiscal coberta por itens via pedido: `0,87%`.

Proxima implementacao:

- criar `scripts/backfill-olist-order-items-for-valid-invoices.js`;
- selecionar somente pedidos vinculados a NFs validas e sem itens;
- processar em lotes limitados com delay, runtime maximo, checkpoint e resume;
- aplicar retry/backoff para rede, `429` e `5xx`;
- registrar processados, sem itens e erros;
- executar a auditoria de cobertura depois de cada lote.

Gate para a view candidata:

- NFs validas com itens via pedido >= `98%`; ou
- receita fiscal sem cobertura < `0,5%`.

Somente apos o gate:

- criar `oraculo_fiscal_sku_sales_by_order_link`;
- auditar distribuicao de receita por SKU;
- manter margem, ROI e ROAS bloqueados ate a auditoria da view candidata.

Commits de referencia:

- `1b61a8c Add official fiscal analytics layer`
- `7bcf78a Audit fiscal invoice item coverage`

---

## O que já foi feito

### 1. Estrutura do projeto

Foi criada a base do monorepo em `/Users/julianocalil/oraculo` com:

- `apps/web` para o app web em Next.js
- `supabase` para migrations e Edge Functions
- `scripts` para importações e jobs operacionais
- `docs` para documentação técnica e de produto
- `vault` para conhecimento persistente estilo Obsidian

Arquivos centrais já existentes:

- [README.md](/Users/julianocalil/oraculo/README.md)
- [AGENTS.md](/Users/julianocalil/oraculo/AGENTS.md)
- [docs/project-context.md](/Users/julianocalil/oraculo/docs/project-context.md)
- [docs/engineering-playbook.md](/Users/julianocalil/oraculo/docs/engineering-playbook.md)
- [docs/runbooks/onboarding-new-agent.md](/Users/julianocalil/oraculo/docs/runbooks/onboarding-new-agent.md)

### 2. App web local

O app Next.js foi instalado e já roda localmente.

Estado atual:

- `apps/web` configurado
- leitura server-side do Supabase implementada
- página inicial trocada de estática para dashboard inicial

Arquivos principais:

- [apps/web/app/page.tsx](/Users/julianocalil/oraculo/apps/web/app/page.tsx)
- [apps/web/app/globals.css](/Users/julianocalil/oraculo/apps/web/app/globals.css)
- [apps/web/lib/supabase/admin.ts](/Users/julianocalil/oraculo/apps/web/lib/supabase/admin.ts)

### 3. Integração Supabase + Olist

Foi feita a base técnica da integração com a Olist/Tiny:

- autenticação OAuth configurada
- callback implementado
- token salvo no Supabase
- sync de estoque preparado
- sync de pedidos preparado

Arquivos relevantes:

- [supabase/functions/olist-oauth-callback/index.ts](/Users/julianocalil/oraculo/supabase/functions/olist-oauth-callback/index.ts)
- [supabase/functions/olist-sync-orders/index.ts](/Users/julianocalil/oraculo/supabase/functions/olist-sync-orders/index.ts)
- [scripts/import-olist-orders-full.js](/Users/julianocalil/oraculo/scripts/import-olist-orders-full.js)
- [scripts/hydrate-olist-order-details.js](/Users/julianocalil/oraculo/scripts/hydrate-olist-order-details.js)
- [scripts/sync-olist-current-month.js](/Users/julianocalil/oraculo/scripts/sync-olist-current-month.js)

### 4. Base atual no Supabase

Tabelas já criadas:

- `public.olist_orders`
- `public.olist_oauth_tokens`
- `public.olist_sync_runs`
- `public.olist_stock_items`
- `public.olist_stock_sync_runs`

Migrations:

- [20260616000100_create_olist_sync.sql](/Users/julianocalil/oraculo/supabase/migrations/20260616000100_create_olist_sync.sql)
- [20260616000200_create_olist_stock_sync.sql](/Users/julianocalil/oraculo/supabase/migrations/20260616000200_create_olist_stock_sync.sql)

### 5. Estoque importado

O estoque da Olist já foi carregado para o Supabase.

Tabela:

- `public.olist_stock_items`

Essa tabela já contém dados úteis de produto e estoque, inclusive payload com:

- `categoria`
- `descricao`
- `marca`
- `gtin`
- `precos`
- `estoque`
- `variacoes`
- `kit`

### 6. Pedidos resetados para o mês atual

Foi executada a limpeza da base de pedidos para deixar apenas o mês atual.

Estado validado em `2026-06-16`:

- `68.541` pedidos entre `2026-06-01` e `2026-06-16`
- `0` pedidos antes de `2026-06-01`
- `0` pedidos depois de `2026-06-16`

Depois disso, a estratégia foi alterada para manter uma janela rolante de `2` meses para trás, pois a inteligência de SKU precisa de mais histórico que apenas o mês corrente.

Em `2026-06-16`, foi executado um backfill de pedidos de `2026-04-01` a `2026-06-16`.

Resultado reportado pelo importador:

- `241.180` pedidos buscados
- `241.180` pedidos enviados para upsert
- `77` janelas diárias processadas
- início: `2026-04-01`
- fim: `2026-06-16`

Observação: a validação final via API do Supabase ficou bloqueada porque o projeto passou a responder `402` com `exceed_egress_quota`. O dono do projeto precisa remover o spend cap ou ajustar o plano para restaurar a API.

### 7. Sincronização automática

O projeto começou com job diário local no macOS via `launchd`, mas a estratégia atual é Supabase-first.

Estado atual em `2026-06-21`:

- `oraculo-olist-orders-hourly`: roda a cada hora no minuto `:05`.
  - Chama `olist-sync-orders`.
  - Payload: `lookbackDays=1`, `maxPages=1`, `hydrateDetails=true`, `detailDelayMs=150`.
  - Objetivo: puxar novos/alterados sem recarregar histórico.
- `oraculo-olist-derived-hourly`: roda a cada hora no minuto `:25`.
  - Chama `olist-derived-refresh` em modo `incremental`.
  - Janela: `current_date - 2 days` até `current_date + 1 day`.
  - Atualiza itens derivados, dimensões leves, vendas/cache e canal/fonte.
  - Não roda snapshot de estoque, produtos ou cache SKU global.
- `oraculo-nf-cache-hourly`: roda a cada hora no minuto `:35`.
  - Executa `refresh_oraculo_nf_daily_cache` diretamente no Postgres.
  - Foi separado da Edge Function para evitar timeout de API.
- `oraculo-olist-stock-6h`: roda a cada 6 horas no minuto `:15`.
  - Chama `olist-sync-stock`.
  - Motivo: estoque/produtos ainda não têm filtro incremental seguro; rodar hora a hora sobrecarregaria API/banco.

O job local via `launchd` permanece documentado como histórico/fallback, mas não deve ser considerado o motor principal enquanto o Supabase cron estiver ativo.

Arquivos:

- [scripts/run-olist-current-month-sync.sh](/Users/julianocalil/oraculo/scripts/run-olist-current-month-sync.sh)
- [scripts/sync-olist-rolling-window.js](/Users/julianocalil/oraculo/scripts/sync-olist-rolling-window.js)
- [ops/launchd/com.oraculo.olist-current-month-sync.plist](/Users/julianocalil/oraculo/ops/launchd/com.oraculo.olist-current-month-sync.plist)
- [supabase/functions/olist-sync-orders/index.ts](/Users/julianocalil/oraculo/supabase/functions/olist-sync-orders/index.ts)
- [supabase/functions/olist-derived-refresh/index.ts](/Users/julianocalil/oraculo/supabase/functions/olist-derived-refresh/index.ts)
- [supabase/functions/olist-sync-stock/index.ts](/Users/julianocalil/oraculo/supabase/functions/olist-sync-stock/index.ts)

Instalação efetiva no sistema:

- `/Users/julianocalil/Library/LaunchAgents/com.oraculo.olist-current-month-sync.plist`

Logs:

- `/Users/julianocalil/oraculo/logs/olist-current-month-sync.log`
- `/Users/julianocalil/oraculo/logs/olist-current-month-sync.err.log`

Validações recentes:

- Payload exato do cron de pedidos processou `100` pedidos em `46s`.
- Derived incremental processou janela `2026-06-20` a `2026-06-22` com sucesso.
- Cron jobs ativos confirmados em `cron.job`.

### 8. Referências de produto recebidas

O projeto agora também tem as referências visuais e funcionais fornecidas:

- [descritivo telas/Oráculo.md](/Users/julianocalil/oraculo/descritivo%20telas/Ora%CC%81culo.md)
- [Tela do Sistema](/Users/julianocalil/oraculo/Tela%20do%20Sistema)

Essas referências já foram lidas e traduzidas para requisitos de dados e produto.

---

## O que o produto precisa ser

O `Oraculo` precisa cumprir cinco papéis:

1. `Base única de dados`
   - Olist entra primeiro
   - depois entram outros canais
   - Supabase/Postgres vira a camada de verdade

2. `Dashboard operacional`
   - não apenas relatório
   - precisa responder perguntas diárias da operação

3. `Inteligência por produto`
   - SKU e produto são entidades centrais
   - performance, estoque, custo, ruptura e retomada precisam ser observáveis

4. `Automação`
   - syncs e derivação de métricas precisam rodar automaticamente

5. `Camada futura de IA`
   - alertas, diagnóstico e recomendação em cima de dados organizados

---

## O que queremos construir nas telas

### Analytics

Blocos esperados:

- receita bruta
- receita efetiva
- vendas
- unidades
- ticket médio
- cancelados
- curva acumulada do mês
- vendas por dia
- receita por loja
- share por loja
- tendência por loja
- ticket médio por loja
- heatmap por dia
- funil por status
- SKUs em ascensão
- SKUs em queda
- top 10 SKUs cross-loja
- distribuição por estado
- top 10 SKUs por receita

### SKUs

Blocos esperados:

- tabela densa orientada a operação
- filtro por período
- comparativos
- classificação `ABC`
- classificação `XYZ`
- receita
- unidades
- ticket
- variação
- trend
- sparkline
- estoque
- dias até ruptura
- custo unitário
- valor em estoque
- última venda
- metas

### Produto detalhado

Blocos esperados:

- resumo do SKU
- score e alertas
- potencial de receita
- projeção
- receita x pedidos ao longo do tempo
- meta vs realizado
- receita perdida
- timeline de eventos
- estoque e custo
- sinais de ruptura, reentrada, alteração, sem venda

---

## O que vamos cruzar

### 1. Pedidos x Itens x SKU

Usos:

- faturamento por SKU
- unidades vendidas
- ticket por SKU
- top produtos
- ascensão e queda

### 2. Pedidos x Canal

Usos:

- receita por loja
- share por loja
- tendência por canal
- ticket médio por canal

### 3. Pedidos x Status

Usos:

- funil operacional
- cancelamentos
- pedidos em aberto
- aprovados, enviados, entregues

### 4. Pedidos x Cliente x Geografia

Usos:

- distribuição por estado
- concentração regional
- receita por UF

### 5. SKU x Estoque

Usos:

- ruptura
- estoque em risco
- estoque parado
- cobertura
- valor em estoque

### 6. SKU x Tempo

Usos:

- tendência
- sparkline
- baseline
- comparação com períodos anteriores
- último dia de venda

### 7. SKU x Custo x Preço

Usos:

- custo unitário
- valor de estoque
- margem potencial
- priorização

### 8. SKU x Eventos

Usos:

- reentrada
- alteração de imagem
- alteração de custo
- alteração de preço
- início de queda ou retomada

---

## O que já temos de dados

### Em pedidos

Hoje a tabela `olist_orders` já preserva o payload bruto da Olist e já entrega, pelo menos, estas dimensões:

- `id`
- `numero_pedido`
- `situacao`
- `data_criacao`
- `data_atualizacao`
- `cliente`
- `transportador`
- `payload`

Na prática, já validamos em payload de pedido campos como:

- `ecommerce.nome`
- `ecommerce.id`
- `numeroPedido`
- `valorTotalPedido`
- `valorTotalProdutos`
- `valorFrete`
- `valorDesconto`
- `pagamento`
- `itens`
- `cliente.endereco.uf`
- `cliente.endereco.municipio`

### Em estoque/produto

Hoje a tabela `olist_stock_items` já entrega ou preserva:

- `produto_id`
- `sku`
- `nome`
- `saldo`
- `disponivel`
- `reservado`
- `depositos`
- `payload`

Na payload já existem campos úteis de produto:

- `categoria`
- `descricao`
- `marca`
- `gtin`
- `precos`
- `estoque`
- `kit`
- `variacoes`
- `situacao`

---

## O que ainda falta

### 1. Itens de pedido normalizados

Hoje os itens ainda estão dentro de `payload.itens`.

Falta criar:

- `public.olist_order_items`

Sem isso, várias métricas ficam mais lentas, mais frágeis e difíceis de manter.

Status atual:

- migration local criada
- script de extração criado
- aplicação remota bloqueada por permissão MCP e, depois, por quota do Supabase

Arquivos:

- [supabase/migrations/20260616170000_create_olist_analytics_foundation.sql](/Users/julianocalil/oraculo/supabase/migrations/20260616170000_create_olist_analytics_foundation.sql)
- [scripts/sync-olist-order-items.js](/Users/julianocalil/oraculo/scripts/sync-olist-order-items.js)

### 2. Dimensão de produto consolidada

Falta uma tabela própria para produto.

Sugestão:

- `public.olist_products`

Ou, em modelo canônico:

- `public.dim_products`

### 3. Dimensão de canal/loja

Hoje o canal vem no payload, mas ainda sem padronização própria.

Falta:

- `public.dim_channels`

Com:

- nome canônico
- nome de exibição
- aliases
- tipo do canal
- agrupamento

### 4. Dicionário de status

Hoje existe `situacao`, mas ainda falta traduzir para estágios operacionais claros.

Falta:

- `public.dim_order_status`

### 5. Histórico suficiente

Hoje a base de pedidos está limitada a `junho de 2026`.

Isso permite:

- visão mensal atual
- comparativos curtos
- operação do dia a dia

Mas não sustenta bem:

- tendência de 3 meses
- ABC confiável
- XYZ confiável
- baseline robusto
- projeção séria de SKU

### 6. Snapshot histórico de estoque

Hoje temos o estado atual do estoque.

Ainda falta guardar snapshots ao longo do tempo para:

- ruptura
- reentrada
- cobertura
- estoque parado
- tempo zerado

Sugestão:

- `public.olist_stock_snapshots`

### 7. Metas

As metas das telas não vêm da Olist.

Precisaremos criar tabelas próprias, por exemplo:

- `public.sales_goals`
- `public.sku_goals`

### 8. Eventos e timeline

Para montar a visão detalhada do produto, falta um registro de eventos.

Exemplos:

- venda
- mudança de custo
- ruptura
- reentrada
- alteração de imagem
- alteração de título
- sem venda

Sugestão:

- `public.product_events`

### 9. Alertas

Os alertas ainda não existem como camada própria.

Sugestão:

- `public.alert_queue`

---

## Diagnóstico atual

### O que já podemos construir com segurança

Com a base atual, já conseguimos construir uma primeira versão de:

- KPIs principais
- vendas por dia
- receita por loja
- share por loja
- funil por status
- distribuição por estado
- top SKUs por receita
- visão inicial de estoque

### O que ainda não devemos vender como pronto

Ainda não dá para afirmar que temos com qualidade:

- inteligência forte de SKU
- tendência histórica robusta
- ABC/XYZ consistente
- receita perdida precisa
- timeline completa do produto
- alertas confiáveis

O principal motivo é simples:

- falta histórico suficiente
- faltam tabelas derivadas
- faltam itens normalizados

---

## Arquitetura de dados recomendada

### Camada 1. Ingestão canônica

Tabelas:

- `olist_orders`
- `olist_order_items`
- `olist_products`
- `olist_stock_snapshots`
- `olist_stock_items`
- `olist_sync_runs`
- `olist_stock_sync_runs`

### Camada 2. Dimensões

Tabelas:

- `dim_products`
- `dim_channels`
- `dim_order_status`
- `dim_states`

### Camada 3. Fatos diários

Tabelas ou materialized views:

- `fact_daily_orders`
- `fact_daily_revenue`
- `fact_daily_channel`
- `fact_daily_sku`
- `fact_daily_stock`

### Camada 4. Inteligência operacional

Tabelas ou views:

- `sku_performance`
- `stock_risk`
- `rupture_risk`
- `sku_movement`
- `top_skus`
- `channel_trends`

### Camada 5. Alertas

Tabelas:

- `alert_queue`
- `product_events`

---

## Ordem correta de execução

### Fase 1. Fechar a primeira camada de dados

1. criar `olist_order_items`
2. extrair itens dos pedidos já importados
3. criar dimensão de produto
4. criar dimensão de canal
5. criar dicionário de status
6. criar snapshots de estoque

### Fase 2. Criar agregações diárias

1. receita diária
2. pedidos diários
3. canal por dia
4. SKU por dia
5. estado por dia
6. status por dia

### Fase 3. Entregar a primeira tela Analytics

Entregar primeiro:

- KPI cards
- curva mensal
- vendas por dia
- receita por loja
- share por loja
- funil por status
- distribuição por estado
- top 10 SKU receita

### Fase 4. Entregar a tela de SKUs

Entregar:

- tabela principal
- filtros de período
- ordenação por receita/unidades/ticket
- estoque
- última venda
- variação
- sparkline

### Fase 5. Entregar a tela detalhada do produto

Entregar:

- resumo
- série temporal
- estoque/custo
- risco
- metas
- timeline

### Fase 6. Alertas

Entregar:

- SKUs em ascensão
- SKUs em queda
- ruptura
- sem venda
- reentrada sem reação

### Fase 7. IA

Somente depois de estabilidade:

- leitura das métricas
- explicação de queda
- priorização
- alertas comentados
- tarefas sugeridas

---

## O que vai ficar

Ao final dessa base, o projeto deve ficar com:

### Backend de dados

- Olist sincronizada automaticamente
- pedidos e itens normalizados
- estoque atual e histórico
- produto consolidado
- canais padronizados
- métricas diárias prontas para consumo

### Produto web

- analytics operacional
- visão de SKU
- drill-down de produto
- alertas

### Governança

- documentação persistente
- contexto legível por qualquer novo agente
- estrutura de projeto estável
- jobs controlados

---

## Decisão importante em aberto

Se o objetivo é reproduzir de verdade a densidade das telas de referência, a base de pedidos não deve ficar somente no mês atual.

### Opção A

Manter somente o mês atual.

Vantagens:

- operação leve
- sync simples
- foco no agora

Limitações:

- pouca inteligência histórica
- projeções fracas
- ABC/XYZ ruim
- queda/ascensão menos confiável

### Opção B

Reimportar de `3` a `6` meses de histórico.

Vantagens:

- tendência real
- baseline comparável
- inteligência de SKU melhor
- alertas melhores
- projeção melhor

Minha recomendação técnica é `Opção B`.

---

## Próximo passo recomendado

O próximo passo mais correto é:

1. modelar as tabelas que faltam
2. criar `olist_order_items`
3. extrair os itens dos pedidos já existentes
4. decidir a janela histórica ideal
5. criar as primeiras views diárias para o dashboard

---

## Ponto de parada em 2026-06-17

Este ponto foi superado. O Supabase voltou a aceitar migrations e consultas, e o projeto avançou para a camada multi-canal.

---

## Estado atualizado em 2026-06-20

### Repositórios e deploy

O projeto está versionado e conectado ao GitHub.

Remotes relevantes:

- `origin`: `https://github.com/Grupo-Jacartta/oraculo.git`
- `personal`: `https://github.com/julianocalill/oraculo-jacartta.git`

Como a Vercel pode estar apontada para o repositório pessoal, os commits recentes foram enviados para os dois remotes.

Decisão de custo:

- usar Vercel sem custo agora;
- manter o repositório pessoal como alternativa para deploy gratuito;
- evitar dependência de Vercel Pro neste estágio.

### App web

O frontend está em:

- [apps/web](/Users/julianocalil/oraculo/apps/web)

Telas existentes:

- [Analytics](/Users/julianocalil/oraculo/apps/web/app/page.tsx)
- [Pedidos](/Users/julianocalil/oraculo/apps/web/app/pedidos/page.tsx)
- [SKUs](/Users/julianocalil/oraculo/apps/web/app/skus/page.tsx)
- [Alertas](/Users/julianocalil/oraculo/apps/web/app/alertas/page.tsx)

O visual foi ajustado para uma tela operacional escura, limpa, com tons roxos e amarelos.

Correções recentes:

- cards e áreas clicáveis;
- filtros de período;
- tooltip na curva do período;
- ranking de SKU com quantidade;
- retirada/renomeação de métricas que confundiam receita bruta, receita confirmada e NF;
- troca de texto para `Receita operacional`, `Vendas confirmadas`, `Canceladas` e `Pendentes`.

Build validado:

```bash
cd /Users/julianocalil/oraculo/apps/web
npm run build
```

Resultado: build Next.js passou.

### Supabase

Supabase é a base canônica.

Principais grupos de tabelas/views/funções:

- Olist: `olist_orders`, `olist_order_items`, `olist_products`, `olist_stock_items`
- Olist OAuth/sync: `olist_oauth_tokens`, `olist_sync_runs`, `olist_stock_sync_runs`
- Shopee Donacor: `shopee_orders`, `shopee_order_items`, `shopee_products`, tabelas auxiliares de sync
- Métricas Olist: `oraculo_daily_sales`, `oraculo_nf_daily_cache`, `oraculo_sku_period_rank`
- Multi-canal: `oraculo_orders_unified`, `oraculo_order_items_unified`, `oraculo_channel_sales_unified`
- Cache multi-canal: `oraculo_channel_sales_unified_cache`
- Produto/SKU unificado: `oraculo_products_unified`, `oraculo_sku_sales_unified`, `oraculo_sku_current_unified`, caches relacionados

Migrations recentes importantes:

- [20260619182000_create_oraculo_cross_channel_views.sql](/Users/julianocalil/oraculo/supabase/migrations/20260619182000_create_oraculo_cross_channel_views.sql)
- [20260619183600_create_oraculo_products_unified.sql](/Users/julianocalil/oraculo/supabase/migrations/20260619183600_create_oraculo_products_unified.sql)
- [20260619195000_create_oraculo_unified_sku_views.sql](/Users/julianocalil/oraculo/supabase/migrations/20260619195000_create_oraculo_unified_sku_views.sql)
- [20260619203000_cache_oraculo_unified_sku_views.sql](/Users/julianocalil/oraculo/supabase/migrations/20260619203000_cache_oraculo_unified_sku_views.sql)
- [20260620110000_create_oraculo_reconciliation_snapshot.sql](/Users/julianocalil/oraculo/supabase/migrations/20260620110000_create_oraculo_reconciliation_snapshot.sql)
- [20260620120000_fix_unified_olist_order_amounts.sql](/Users/julianocalil/oraculo/supabase/migrations/20260620120000_fix_unified_olist_order_amounts.sql)
- [20260620121500_cache_oraculo_channel_sales_unified.sql](/Users/julianocalil/oraculo/supabase/migrations/20260620121500_cache_oraculo_channel_sales_unified.sql)
- [20260620123000_optimize_unified_channel_cache_refresh.sql](/Users/julianocalil/oraculo/supabase/migrations/20260620123000_optimize_unified_channel_cache_refresh.sql)

### Olist

Olist está conectada via OAuth, com refresh token salvo no Supabase.

O sync automático diário foi planejado para rodar pelo Supabase/n8n, com refresh token automático e sem aprovação manual.

Estado dos dados:

- pedidos importados;
- itens normalizados existem, mas a cobertura precisa ser monitorada;
- produtos/estoque importados;
- payload bruto preservado em JSONB;
- detalhes de pedido podem trazer `itens` e `dataFaturamento`, mas `dataFaturamento` vem vazio em muitos pedidos válidos.

Ponto crítico descoberto:

- `dataFaturamento` não pode ser tratado como fonte única da receita operacional enquanto a cobertura estiver incompleta.
- A métrica operacional deve usar `data_criacao` + status.
- A métrica fiscal por NF deve ser separada e auditada.

### Shopee Donacor

Dados da loja Donacor na Shopee foram puxados para o mesmo banco.

Regra de segurança e produto:

- Shopee é somente leitura.
- O Oraculo nunca deve alterar pedido, estoque, preço, produto ou qualquer dado dentro da Shopee.
- A integração Shopee serve para cruzar pedidos, itens, receita, quantidade e produto com Olist e outros canais.

Estado atual no cache de junho:

- `9.873` pedidos Shopee
- `1.106` cancelados
- `R$ 601.481,08` de receita líquida operacional

### Métricas e auditoria

Foi criado o contrato oficial:

- [docs/metric-contract.md](/Users/julianocalil/oraculo/docs/metric-contract.md)

Regras atuais:

- `Receita operacional`: pedidos válidos no período, excluindo cancelados e pendentes.
- `Vendas confirmadas`: pedidos com status não pendente/cancelado.
- `Canceladas`: status cancelado.
- `Pendentes`: status pendente.
- `Ticket médio`: receita operacional / vendas confirmadas.
- `NF fiscal`: somente quando houver `dataFaturamento`, separada da visão operacional.

Foi criado o audit executável:

- [scripts/audit-oraculo-metrics.js](/Users/julianocalil/oraculo/scripts/audit-oraculo-metrics.js)

Uso:

```bash
cd /Users/julianocalil/oraculo
node scripts/audit-oraculo-metrics.js --start=2026-06-01 --end=2026-06-30
```

Resultado observado para junho:

- Olist por criação do pedido: `69.501` pedidos
- Olist cancelados: `554`
- Olist pendentes: `18`
- Receita Olist preferencial: `R$ 5.097.896,89`
- Olist por `dataFaturamento`: `656` NFs
- Receita por `dataFaturamento`: `R$ 42.968,72`

Diagnóstico:

- O número operacional de junho existe e é útil.
- O número fiscal por NF ainda não representa a operação inteira.
- O dashboard não deve misturar os dois conceitos.

### Cache multi-canal

Foi criado cache diário para evitar timeout nas views unificadas:

- `oraculo_channel_sales_unified_cache`
- função `refresh_oraculo_channel_sales_unified_cache`
- script [scripts/refresh-oraculo-unified-channel-cache.js](/Users/julianocalil/oraculo/scripts/refresh-oraculo-unified-channel-cache.js)

Uso:

```bash
cd /Users/julianocalil/oraculo
node scripts/refresh-oraculo-unified-channel-cache.js --start=2026-06-01 --end=2026-06-30
```

Resultado observado:

- `225` linhas de cache geradas para junho.
- O dashboard agora consulta o cache, não a view bruta pesada.

### Skills e documentação

Foram avaliadas skills locais e foi criado um processo mais claro:

- Codex/terminal para desenvolvimento e execução técnica;
- VS Code opcional para inspeção visual e edição manual;
- GitHub como versionamento e deploy;
- Obsidian como memória auxiliar, mas docs do repo são oficiais;
- Supabase como backend e banco;
- Vercel como hosting frontend.

Docs relevantes criados/atualizados:

- [docs/metric-contract.md](/Users/julianocalil/oraculo/docs/metric-contract.md)
- [docs/project-context.md](/Users/julianocalil/oraculo/docs/project-context.md)
- [docs/runbooks/roadmap-consultoria-action-plan-2026-06-18.md](/Users/julianocalil/oraculo/docs/runbooks/roadmap-consultoria-action-plan-2026-06-18.md)
- [docs/product/analytics-foundation.md](/Users/julianocalil/oraculo/docs/product/analytics-foundation.md)

### O que está funcionando

- App Next.js compila.
- Supabase aceita migrations.
- Olist OAuth funciona.
- Olist pedidos/estoque/produtos estão no banco.
- Shopee Donacor foi importada em modo somente leitura.
- Views multi-canal existem.
- Cache multi-canal foi criado e preenchido.
- Dashboard carrega métricas por período e fonte a partir do cache.
- Auditoria de métricas já aponta divergências entre visão operacional e fiscal.

### O que ainda não está confiável

- ROI por produto: ainda falta custo e regra de cálculo.
- Margem por produto: ainda faltam custos, impostos, tarifas e frete subsidiado por canal.
- `dataFaturamento` em pedidos não é fonte fiscal; a camada oficial de cabeçalho já usa `olist_invoices`.
- Itens fiscais/por pedido ainda não têm cobertura suficiente para SKU oficial.
- Itens vendidos no dashboard ainda precisam ser reconciliados com a cobertura real de `olist_order_items`.
- Produto mãe/simples em ruptura ainda precisa ser refinado para não misturar kit, SKU filho e item de marketplace.
- ABC/XYZ ainda não deve ser tratado como pronto.
- Alertas de margem ainda não existem como camada configurável.

### Próxima fase

Fase seguinte aprovada conceitualmente pelo usuário:

1. Criar tabela de parâmetros de margem por produto/canal. `Feito em 2026-06-20`
2. Definir custo do produto, imposto, tarifa, frete subsidiado e regra de ROI. `Base criada; valores ainda precisam ser configurados`
3. Criar visão/tabela de `product_margin_snapshot`. `Primeira versão criada como oraculo_sku_margin_30d`
4. Ajustar tela de SKU/produto para mostrar. `Primeira versão feita em /skus`
   - receita;
   - quantidade vendida;
   - estoque;
   - última venda;
   - dias sem venda;
   - margem;
   - ROI;
   - alerta de margem.
5. Criar curva de saída e não saída por produto.
6. Criar alertas de ruptura e produto parado por produto mãe/simples.
7. Só depois avançar para IA explicativa.

### Avanço em margem/ROI em 2026-06-20

Foram adicionadas as tabelas de parâmetro:

- `oraculo_margin_channel_params`
- `oraculo_margin_sku_params`

Foi adicionada a view:

- `oraculo_sku_margin_30d`

A tela [SKUs](/Users/julianocalil/oraculo/apps/web/app/skus/page.tsx) passou a mostrar:

- margem 30d;
- ROI 30d;
- lucro estimado;
- custo unitário;
- status da margem.

Regra de segurança de produto:

- quando faltam parâmetros de canal, o status fica `Configurar`;
- quando falta custo, o status fica `Sem custo`;
- o sistema não deve vender margem/ROI como definitivo até os parâmetros serem preenchidos e validados.

### Aba de parâmetros manuais

Foi decidido que qualquer informação necessária para margem/ROI que não venha da Olist ou das APIs dos marketplaces deve ser enviada manualmente pelo app.

Foi criada a tela:

- [apps/web/app/parametros/page.tsx](/Users/julianocalil/oraculo/apps/web/app/parametros/page.tsx)

Uso da tela:

- digitar parâmetros de canal diretamente no frontend;
- digitar exceções/custos por SKU diretamente no frontend;
- visualizar parâmetros atuais de canal;
- visualizar overrides recentes por SKU;
- acompanhar quantos SKUs têm custo e quantos ainda precisam de preenchimento.

Regra de governança:

- O que conseguimos puxar automaticamente da Olist ou APIs dos marketplaces deve continuar vindo por sync.
- O que não vier por API deve ser colocado em `Parâmetros`, sem edição direta no banco.
- Shopee segue como somente leitura: a tela grava parâmetros internos do Oraculo, nunca altera dados dentro da Shopee.

### Login e controle de usuários

Foi adicionada autenticação no app usando Supabase Auth.

Arquivos principais:

- [apps/web/app/login/page.tsx](/Users/julianocalil/oraculo/apps/web/app/login/page.tsx)
- [apps/web/app/usuarios/page.tsx](/Users/julianocalil/oraculo/apps/web/app/usuarios/page.tsx)
- [apps/web/lib/auth/session.ts](/Users/julianocalil/oraculo/apps/web/lib/auth/session.ts)
- [apps/web/middleware.ts](/Users/julianocalil/oraculo/apps/web/middleware.ts)

Comportamento:

- sem sessão, o app redireciona para `/login`;
- se não existir nenhum usuário no Supabase Auth, `/login` cria o primeiro administrador;
- depois do primeiro usuário, `/login` vira tela de entrada;
- `/usuarios` permite criar e editar usuários;
- somente usuários com `app_metadata.role = admin` acessam o controle de usuários;
- usuários podem ser marcados como admin ou usuário comum;
- usuários podem ser bloqueados/desbloqueados;
- a sessão usa cookies HTTP-only e tenta renovar o access token com refresh token.

---

## Referências relacionadas

- [docs/product/analytics-foundation.md](/Users/julianocalil/oraculo/docs/product/analytics-foundation.md)
- [vault/00-home/index.md](/Users/julianocalil/oraculo/vault/00-home/index.md)
- [vault/05-integrations/olist.md](/Users/julianocalil/oraculo/vault/05-integrations/olist.md)
