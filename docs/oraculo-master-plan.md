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

## Estado executivo em 2026-06-20

O projeto saiu da fase de prova isolada da Olist e entrou na fase de consolidação multi-canal e reconciliação de métricas.

O foco definido pelo usuário agora é:

- entendimento rápido e prático de ROI por produto;
- curva de saída e de não saída de produto;
- margem por produto;
- alertas de margem conforme parâmetros configuráveis no frontend;
- visão confiável por SKU, canal, estoque, ruptura e dias sem venda;
- dados da Olist e marketplaces cruzados no mesmo banco.

Decisão importante: antes de avançar em ROI/margem, o projeto precisa ter métricas auditáveis. Foi identificado que parte dos números do dashboard estava semanticamente incorreta: a tela chamava de `NFs emitidas` e `receita confirmada`, mas a métrica vinha de pedidos criados/status, não de `dataFaturamento` fiscal completo.

Por isso, foi criada uma camada de contrato e auditoria:

- [docs/metric-contract.md](/Users/julianocalil/oraculo/docs/metric-contract.md)
- [scripts/audit-oraculo-metrics.js](/Users/julianocalil/oraculo/scripts/audit-oraculo-metrics.js)
- função Supabase `oraculo_reconciliation_snapshot`

Resultado da auditoria para `2026-06-01` a `2026-06-30`:

- Olist por data de criação do pedido: `69.501` pedidos
- Olist cancelados: `554`
- Olist pendentes: `18`
- Receita operacional Olist preferencial: `R$ 5.097.896,89` bruta e cerca de `R$ 5.060.984,62` líquida operacional no cache de canais
- Olist com `dataFaturamento` fiscal preenchida no período: `656` NFs
- Receita por `dataFaturamento` fiscal preenchida: `R$ 42.968,72`
- Shopee Donacor importada no cache de canais: `9.873` pedidos, `1.106` cancelados, `R$ 601.481,08` líquido operacional

Leitura correta:

- O dashboard principal deve falar em `receita operacional` e `vendas confirmadas`, não em `NF fiscal`, enquanto `dataFaturamento` estiver incompleto.
- A visão fiscal por NF só deve ser usada como auditoria específica, não como KPI principal da operação.
- ROI e margem ainda não podem ser exibidos como prontos porque faltam custo, impostos, tarifas, frete subsidiado e parâmetros por canal/produto.

Commit de referência:

- `a200b0b Add metric reconciliation and channel cache`

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

### 7. Agendamento diário

Foi instalado um job diário local no macOS via `launchd` para sincronizar pedidos às `10:00` da manhã.

O job foi ajustado para usar a janela rolante de `2` meses, não apenas o mês atual.

Arquivos:

- [scripts/run-olist-current-month-sync.sh](/Users/julianocalil/oraculo/scripts/run-olist-current-month-sync.sh)
- [scripts/sync-olist-rolling-window.js](/Users/julianocalil/oraculo/scripts/sync-olist-rolling-window.js)
- [ops/launchd/com.oraculo.olist-current-month-sync.plist](/Users/julianocalil/oraculo/ops/launchd/com.oraculo.olist-current-month-sync.plist)

Instalação efetiva no sistema:

- `/Users/julianocalil/Library/LaunchAgents/com.oraculo.olist-current-month-sync.plist`

Logs:

- `/Users/julianocalil/oraculo/logs/olist-current-month-sync.log`
- `/Users/julianocalil/oraculo/logs/olist-current-month-sync.err.log`

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
- `dataFaturamento` fiscal da Olist: cobertura insuficiente no banco para ser KPI principal.
- Itens vendidos no dashboard ainda precisam ser reconciliados com a cobertura real de `olist_order_items`.
- Produto mãe/simples em ruptura ainda precisa ser refinado para não misturar kit, SKU filho e item de marketplace.
- ABC/XYZ ainda não deve ser tratado como pronto.
- Alertas de margem ainda não existem como camada configurável.

### Próxima fase

Fase seguinte aprovada conceitualmente pelo usuário:

1. Criar tabela de parâmetros de margem por produto/canal.
2. Definir custo do produto, imposto, tarifa, frete subsidiado e regra de ROI.
3. Criar visão/tabela de `product_margin_snapshot`.
4. Ajustar tela de SKU/produto para mostrar:
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

---

## Referências relacionadas

- [docs/product/analytics-foundation.md](/Users/julianocalil/oraculo/docs/product/analytics-foundation.md)
- [vault/00-home/index.md](/Users/julianocalil/oraculo/vault/00-home/index.md)
- [vault/05-integrations/olist.md](/Users/julianocalil/oraculo/vault/05-integrations/olist.md)
