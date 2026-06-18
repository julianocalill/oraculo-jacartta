# Plano executivo - Oraculo

## Visao geral

O Oraculo sera a camada central de inteligencia operacional da empresa. A primeira entrega conecta os dados da Olist ao Supabase, organiza pedidos, produtos, estoque e canais em uma base unica, e transforma esses dados em indicadores diarios para tomada de decisao.

O objetivo nao e criar apenas mais um dashboard. O objetivo e criar uma base confiavel para acompanhar venda, estoque, desempenho de SKU, ruptura, produtos parados, canais de venda e alertas operacionais em um unico lugar.

## O problema que queremos resolver

Hoje, parte das decisoes operacionais depende de consultas manuais, telas separadas, planilhas ou analises feitas depois que o problema ja aconteceu. Isso cria alguns riscos:

- dificuldade para saber rapidamente o que vendeu, onde vendeu e quanto gerou
- baixa visibilidade sobre produtos que estao em ruptura ou proximos de ruptura
- demora para identificar SKUs em queda, SKUs em ascensao e produtos parados
- retrabalho entre operacao, compras, comercial e financeiro
- dependencia de relatorios manuais para fechar a leitura do negocio

O Oraculo reduz esse atrito criando uma fonte unica de dados operacionais.

## O que iremos construir

A primeira versao do Oraculo sera composta por quatro blocos principais.

## 1. Base unica de dados

Vamos concentrar os dados da Olist em uma base Supabase/Postgres. Essa base sera a camada canonica do projeto, ou seja, o lugar onde os dados ficam organizados e prontos para consulta.

Dados previstos nesta fase:

- pedidos
- itens dos pedidos
- produtos
- SKUs
- estoque
- canais/lojas
- status dos pedidos
- historico de sincronizacoes

Como faremos:

- manteremos a integracao atual com a API da Olist
- usaremos upsert para evitar duplicidade de pedidos e itens
- criaremos consultas paginadas para nao perder dados por limite de API
- manteremos tokens e chaves apenas no backend
- criaremos uma camada analitica com views de leitura para alimentar o painel

## 2. Dashboard operacional

O painel inicial mostrara os principais indicadores do dia e do mes.

Indicadores previstos:

- receita bruta
- receita efetiva
- numero de vendas
- unidades vendidas
- ticket medio
- pedidos cancelados
- curva acumulada do mes
- vendas por dia
- receita por loja/canal
- share por loja/canal
- funil por status
- top SKUs por receita
- SKUs em queda
- SKUs em ascensao
- produtos em risco de ruptura

Como faremos:

- criaremos views no banco para consolidar os indicadores
- o frontend em Next.js consumira essas views
- a tela sera orientada para leitura rapida, nao para exibicao decorativa
- os dados serao atualizados por rotinas de sincronizacao

## 3. Inteligencia por SKU

Produto e SKU serao tratados como ativos operacionais. A ideia e saber nao apenas quanto vendeu, mas o que esta mudando.

Leituras previstas:

- receita por SKU
- unidades vendidas por SKU
- estoque disponivel
- dias estimados ate ruptura
- ultima venda
- variacao de performance contra periodo anterior
- valor estimado em estoque
- custo unitario quando disponivel
- produtos parados
- produtos com alta demanda

Como faremos:

- cruzaremos itens de pedido com cadastro de produto e estoque
- calcularemos vendas dos ultimos 30 dias e periodo anterior
- classificaremos sinais como ruptura, ruptura iminente, parado ou em crescimento
- depois evoluiremos para curvas ABC/XYZ e metas por produto

## 4. Alertas e automacao

Depois da base e do dashboard, criaremos um motor de alertas. Ele devera abrir alertas quando uma regra for acionada e fechar automaticamente quando o problema deixar de existir.

Exemplos:

- produto com estoque zerado
- produto com menos de 7 dias ate ruptura
- SKU com queda relevante de vendas
- SKU sem venda ha muitos dias
- canal com queda de faturamento
- pedidos em status critico

Como faremos:

- criaremos tabelas de regras e alertas
- criaremos uma rotina que avalia os dados diariamente
- cada alerta tera status aberto ou resolvido
- no inicio, a notificacao pode ser por email; depois, WhatsApp ou outro canal interno

## Plano de execucao

## Etapa 1 - Desbloquear Supabase

Status atual: o Supabase esta retornando erro de cota (`402 exceed_egress_quota`). Antes de validar os dados reais, precisamos liberar o projeto removendo o bloqueio de cota ou ajustando o plano.

Entrega esperada:

- API do Supabase respondendo normalmente
- consultas basicas de pedidos e estoque funcionando

## Etapa 2 - Aplicar camada analitica

Aplicaremos as migrations pendentes do banco, incluindo a camada de views analiticas ja preparada.

Entregas esperadas:

- fatos de pedido consolidados
- vendas por dia
- vendas por canal
- vendas por SKU
- leitura atual de SKUs
- watchlist de estoque

## Etapa 3 - Reprocessar dados

Rodaremos os scripts para recompor itens de pedido, dimensoes, produtos e snapshot de estoque.

Entregas esperadas:

- pedidos atualizados
- itens ligados aos pedidos
- produtos normalizados
- canais identificados
- estoque fotografado no dia

## Etapa 4 - Atualizar tela inicial

Trocaremos a tela atual, que ainda esta mais focada em estoque, por um dashboard operacional completo.

Entregas esperadas:

- resumo executivo do mes
- graficos e tabelas de vendas
- top SKUs
- sinais de ruptura
- leitura por canal/loja

## Etapa 5 - Validar com operacao

Faremos uma revisao dos numeros com a operacao para confirmar se o painel bate com a realidade.

Pontos de validacao:

- total de pedidos
- receita do periodo
- cancelados
- top produtos
- estoque de SKUs criticos
- canais com maior receita

## Etapa 6 - Evoluir para alertas

Com a base validada, construiremos o motor de alertas.

Entregas esperadas:

- regras de alerta
- alertas abertos e resolvidos
- tela de alertas
- notificacao inicial por email

## Beneficios por setor

## Operacoes

Beneficios:

- visao rapida de ruptura e risco de ruptura
- reducao de verificacoes manuais
- priorizacao de produtos que precisam de acao
- acompanhamento de pedidos por status
- identificacao de gargalos antes de virarem problema maior

Impacto esperado:

- menos atraso operacional
- menos venda perdida por falta de produto
- maior velocidade para decidir onde agir

## Compras e abastecimento

Beneficios:

- identificacao de SKUs com giro alto
- leitura de dias ate ruptura
- lista de produtos parados
- apoio para decisao de reposicao
- melhor visibilidade sobre estoque com capital parado

Impacto esperado:

- compras mais orientadas por demanda real
- reducao de ruptura
- reducao de excesso de estoque em produto parado

## Comercial e marketplace

Beneficios:

- leitura de receita por canal
- top SKUs cross-loja
- SKUs em ascensao e em queda
- acompanhamento de ticket medio
- suporte para campanhas e ajustes de preco

Impacto esperado:

- foco nos produtos com maior potencial
- reacao mais rapida a queda de venda
- melhor comparacao de performance entre canais

## Financeiro

Beneficios:

- receita bruta e receita efetiva em uma base unica
- acompanhamento de cancelados
- leitura de valor estimado em estoque
- base para evoluir margem por SKU
- reducao de dependencia de consolidacoes manuais

Impacto esperado:

- fechamento gerencial mais rapido
- melhor previsibilidade de faturamento
- maior controle sobre capital em estoque

## Diretoria

Beneficios:

- visao consolidada da operacao
- indicadores confiaveis sem depender de planilhas isoladas
- leitura diaria de vendas, estoque e canais
- capacidade de priorizar decisoes com base em dados
- base preparada para alertas e inteligencia artificial no futuro

Impacto esperado:

- decisao mais rapida
- menos dependencia de relatos manuais
- melhor governanca operacional
- ganho de escala para novos canais e integracoes

## Atendimento e pos-venda

Beneficios:

- melhor leitura de pedidos por status
- identificacao de problemas recorrentes por canal
- possibilidade futura de alertas sobre atrasos ou status criticos

Impacto esperado:

- atendimento mais proativo
- menos surpresa operacional
- mais clareza para explicar situacoes internas

## Tecnologia e dados

Beneficios:

- dados organizados em Supabase/Postgres
- scripts versionados
- migrations rastreaveis
- documentacao persistente no repositorio
- arquitetura pronta para novas integracoes

Impacto esperado:

- menor risco de perda de contexto
- evolucao mais segura
- facilidade para outro desenvolvedor ou agente continuar o projeto

## Indicadores de sucesso

A primeira versao sera considerada bem-sucedida quando conseguirmos responder, em poucos cliques:

- quanto vendemos hoje e no mes?
- qual foi a receita efetiva?
- quantos pedidos foram cancelados?
- quais canais mais venderam?
- quais SKUs mais geraram receita?
- quais SKUs estao em queda?
- quais produtos estao em risco de ruptura?
- quais produtos estao parados?
- quando foi a ultima sincronizacao confiavel?

## Riscos e mitigacoes

## Cota do Supabase

Risco: a base ficar indisponivel por limite de plano ou spend cap.

Mitigacao:

- liberar o projeto atual
- acompanhar consumo
- otimizar consultas usando views e filtros
- evitar puxar dados desnecessarios para o frontend

## Qualidade dos dados da origem

Risco: campos da Olist virem incompletos ou inconsistentes.

Mitigacao:

- preservar payload bruto
- normalizar em tabelas auxiliares
- validar os principais numeros com a operacao
- criar regras de fallback nos calculos

## Excesso de informacao na tela

Risco: transformar o painel em um relatorio grande demais.

Mitigacao:

- definir um numero principal
- separar visao executiva, SKU e alertas
- priorizar indicadores acionaveis

## Alertas sem resolucao automatica

Risco: acumular alertas antigos e perder confianca no sistema.

Mitigacao:

- todo alerta criado tera regra de fechamento
- alertas terao status aberto/resolvido
- a rotina de avaliacao criara e encerrara alertas

## Proxima decisao recomendada

Para a primeira versao, recomendamos definir como indicador principal:

**Receita efetiva do mes.**

Esse numero deve orientar a tela inicial. A margem pode entrar como segunda camada quando o custo por SKU estiver validado e confiavel.

## Conclusao

O Oraculo cria uma base operacional unica para transformar dados de venda e estoque em acao. A empresa ganha velocidade para identificar problemas, priorizar reposicao, acompanhar canais, entender performance de SKU e reduzir dependencia de processos manuais.

Com a liberacao do Supabase, a proxima etapa e aplicar a camada analitica, validar os dados reais e evoluir a tela inicial para o dashboard operacional que servira como centro diario de decisao.
