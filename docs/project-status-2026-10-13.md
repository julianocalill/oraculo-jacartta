# Auditoria dos dados da Giracasa em 13 de outubro de 2026

As correções da Giracasa foram implementadas após autorização de publicação.
As duas migrations e as 11 funções produtoras próprias estão aplicadas em
produção; os jobs já recuperam o histórico. Frontend com build e testes
aprovados, pronto para push nos dois remotes e confirmação do deploy Vercel.

## Correções e recuperação em produção

- Pedidos Olist passam a buscar detalhes. A fila desde 08/09 é consumida a
  cada 2 minutos em lotes de até 50 pedidos/90 segundos, com proteção contra
  sobreposição. Depois da recuperação inicial, mantém os últimos 7 dias.
- Shopee tem produtores por loja de pedidos, catálogo, FBS, escrow,
  reconciliação, devoluções, Ads e preços. Recuperação desde 01/08 usa
  janelas diárias, até quatro páginas por lote, cursor salvo depois de cada
  página persistida e lease para impedir duas execuções simultâneas.
- Cache de vínculo à NF de venda foi preenchido até 13/10. Caches de
  quantidades, SKUs e séries Shopee são revistos de hora em hora. Cursores e
  informações financeiras continuam restritos a service_role.
- Ads/SP ganhou RPC própria com SECURITY INVOKER e políticas de operação.
  A página foi liberada com as mesmas regras de cobertura do dashboard MG.
- Previsão e export usam o mesmo builder: semanas usadas com cobertura de
  itens abaixo de 90% deixam previsão/tendência indisponíveis. O gráfico não
  apresenta a legenda de uma previsão inexistente como zero unidades.
- SKUs e Mais Vendidos distinguem quantidade não carregada de zero medido;
  a cobertura fiscal dos itens da NF é explicada separadamente. Reconciliação
  não confirma NFs ou créditos antes da coleta; saldo sem posição datada
  fica indisponível. Escrow indica backlog mesmo quando um lote terminou.
- O filtro Take Rate lista lojas da operação selecionada. Inteligência/SP
  apresenta preço e estoque observados do catálogo, sem aplicar a fórmula
  tributária de MG a SP; recomendações de margem dependem de conciliação
  fiscal por anúncio. O estado vazio foi protegido contra erro de render.
- Status mostra os produtores Shopee e a fila comercial Olist. Full e Bip
  aparecem como não configurados em SP; ML depende de conta própria.
  Devoluções informa a cobertura por fonte e remove exemplos históricos
  fixos de MG da tela paulista.

Em 13/10 às 11h14 BRT: 1.228 pedidos Shopee, 387 variações de produtos,
187 linhas de preço, 64 extratos com sucesso, 3.480 linhas diárias de Ads,
808 devoluções e 1.600 linhas de reconciliação. Olist recuperou 225 linhas
comerciais desde 08/09; cerca de 29 mil pedidos ainda estavam na fila.
**Essas contagens comprovam avanço da coleta, não conclusão do histórico.**
Evidência: [recovery-validation.json](analyses/giracasa-auditoria-2026-10-13/recovery-validation.json).

Migrations aplicadas via CLI db query --linked --file:
`20261013133510_giracasa_ingestion_recovery.sql` e
`20261013135916_giracasa_safe_inventory.sql`. Funções são geradas por
`scripts/build-operation-functions.mjs`, com schema e secrets exclusivos de SP.
O builder também aplica Accept-Profile Giracasa à validação REST interna da
reconciliação. Renovadores de token foram preservados.

A revisão automática recusou o catálogo por autenticação condicional e o
FBS por apagar a posição antes de inserir a reposição. Ambos foram corrigidos:
produtores exigem segredo mesmo quando ele estiver ausente; troca FBS ocorre
numa única transação após coleta completa e recusa lista vazia, duplicada ou
com identidade divergente. Falhas mantêm o retrato anterior. Os deploys das
versões corrigidas foram aceitos. O cache de preço preserva a última linha
conhecida quando um anúncio não veio no lote.

Validação: 114 testes de domínio e seis de produtor/retomada passaram;
TypeScript e build de produção passaram. RPC Ads consultada sob authenticated;
cursores e RPC de escrita recusam esse papel. HTTP sem segredo retornou 401;
com o segredo próprio, preço atualizou 187 linhas. Teste SQL confirmou que
inventário vazio é recusado sem modificar a posição. O linter apontou INFO
por ausência de políticas nas tabelas service_role-only, deliberada;
[referência do linter](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Os demais avisos existentes do projeto não foram alterados por esta entrega.

Limites: históricos Olist/Shopee e os ciclos de carteira/pendências continuam
em processamento automático. ML/SP precisa de conta; a identidade Vari Útil
precisa ser confirmada; TikTok depende de upload por período. Não houve nova
conferência de login de produção. A prévia localhost encontrou um ciclo de
redirecionamento de desenvolvimento, portanto a validação visual autenticada
não foi concluída nesta etapa. Build e consultas reais foram validados.

## Auditoria inicial antes da autorização de publicação

A operação paulista tinha vendas registradas, mas suas telas operacionais
recebiam fontes incompletas. Os zeros não comprovavam ausência de movimento.
Os números e achados abaixo são o retrato inicial anterior às correções.

Estado publicado do frontend: [calculadora por operação de 09/10](project-status-2026-10-09.md).
Evidências agregadas: [evidence.json](analyses/giracasa-auditoria-2026-10-13/evidence.json).
Reprodução: [audit.sql](analyses/giracasa-auditoria-2026-10-13/audit.sql).

## Vendas registradas e itens ausentes

Consultas em 13/10, aproximadamente entre 10h11 e 10h19 BRT, projeto
`bbtiipnmdxfxnxbemgjr`, schema `giracasa`. Valores em BRL; outubro até o
instante da leitura é um período parcial. Estes são os registros do Oráculo,
sem nova comparação direta com a tela do ERP nesta auditoria.

| Medida | Resultado |
| --- | ---: |
| Pedidos criados desde 01/10 | 8.263 |
| Pedidos não cancelados desde 01/10 | 8.215 |
| Pedidos de outubro com itens comerciais | 0 |
| NFs válidas emitidas desde 01/10 | 7.305 |
| Receita fiscal dessas NFs | R$ 474.804,35 |
| NFs de outubro com itens fiscais | 7.305, ou 100% |
| NFs de outubro com itens comerciais do pedido | 0 |
| Última data de pedido importado | 13/10/2026 |
| Última data com itens comerciais | 07/09/2026 |
| Pedidos sem itens desde 08/09 | 29.131, sendo 29.069 não cancelados |

A causa está nos produtores. O job `giracasa-olist-orders-hourly` manda
`lookbackDays`, `pageSize` e `maxPages`, mas omite `hydrateDetails`. A versão
implantada busca detalhes somente quando esse campo é `true`; os últimos
runs confirmam `hydrate_details=false`. O produtor de derivados só extrai
itens já presentes no payload, e os pedidos de outubro não têm esses itens.

O job `giracasa-olist-order-items-backfill` manda apenas `maxOrders`, enquanto
a função usa `limit` e datas explícitas. Sem datas, aplica os defaults legados
**01/06 a 19/06/2026**. Os três últimos runs terminaram como `success`, com zero
pedidos processados e zero itens. O histórico desta operação começa em 30/07.
A fila existente cobre 30/07–07/09 e está concluída; não há fila preparada
para o intervalo posterior. Mudar somente as datas do dispatch não cria essa
fila: é necessário prepará-la antes, pela função própria da operação.

## Consequência em cada tela

| Tela | Diagnóstico confirmado |
| --- | --- |
| Ranking de lojas e produtos | O cache de outubro tem 8.215 pedidos válidos, mas zero unidades e zero pedidos cobertos por itens. O ranking por quantidade não representa o volume vendido. |
| SKUs | As 792 linhas Olist da view operacional têm receita e unidades de 30 dias zeradas. O cache foi atualizado em 13/10; a fonte de itens está incompleta. |
| Previsão de Vendas | Reproduzida a previsão de 19–25/10: zero unidades e tendência limitada a −30%. As quatro semanas-base têm 21.302 pedidos e cobertura de itens de 0%. A queda calculada é efeito da falta de dados. |
| Shopee Take Rate | `shopee_order_escrow` e seus agregados estão vazios. Não há extrato financeiro carregado que sustente taxas e líquido em zero. |
| Inteligência | `shopee_products` e o cache preço × custo estão vazios. O loader depende dessas duas fontes e devolve `internalSource=unavailable` para Giracasa. |
| Reconciliação | Zero linhas; resumo com `last_synced_at=null`; carteira com `wallets_count=0` e `balance_as_of=null`. Os textos “NF localizada em todos os pedidos” e “créditos conferem com o líquido” são afirmações sem conferência nesse estado. |
| Shopee Ads | A página bloqueia qualquer operação diferente de Uberlândia. Além disso, `giracasa.oraculo_ads_dashboard` não existe e as tabelas/coletas estão vazias. Retirar apenas o bloqueio não resolve. |
| Mercado Livre | Zero contas e anúncios próprios cadastrados. As NFs Olist de vendas ML não substituem a integração do catálogo e estoque ML. |
| Devoluções | Zero devoluções canônicas, nenhuma coleta Shopee de devoluções registrada e cache de vínculo à NF de venda vazio. Não permite concluir taxa de devolução zero. |
| Status | Faltam as 12 tabelas do fluxo Full, incluindo `oraculo_full_sync_runs` e `oraculo_fulls`. O erro de tabela inexistente do print é real; recarregar o schema cache não cria esses objetos. |

O card de cobertura fiscal em SKUs está medindo **itens da NF**, embora os
nomes legados dos campos contenham `order_items`. Sua cobertura de 100% é
compatível com zero itens comerciais. Ela não libera a qualidade do ranking
operacional; as duas coberturas devem ser apresentadas separadamente.

Em Devoluções, os exemplos fixos “em julho a Shopee teve ~3.400 devoluções,
o TikTok 1.725 e o Mercado Livre 4” e a referência a 5,5% de disputas TikTok
são exibidos também para SP. Não são medidas desta operação ou do filtro atual.

## Integrações e rotinas da operação

Há uma loja Shopee cadastrada: `984950642`, partner `2044231`,
“Giracasa — Shopee”. O token armazenado estava atualizado e dentro da validade
em 13/10. Entretanto, o único run de importação de pedidos é de **11/09**:
87 pedidos e 87 itens. A rotina que continua executando é a renovação do token,
não a ingestão das vendas.

Os 13 jobs `giracasa-*` ativos cobrem Olist, caches fiscais/comerciais e token
Shopee. Não há jobs próprios de importação de pedidos Shopee, catálogo,
inventário FBS, escrow, reconciliação, devoluções ou Ads. As funções Shopee
correspondentes estão implantadas, mas implantação sem agendamento não
alimenta as tabelas. Algumas também precedem mudanças posteriores ao clone
inicial e precisam de revisão antes da ativação.

O Olist distingue **Shopee Gira Casa** e **Shopee Vari Útil**: em outubro,
R$ 284.228,40 e R$ 116.982,32 de receita fiscal, respectivamente. Uma conta própria
é a única cadastrada em `shopee_shops`. Confirmar se “Vari Útil” identifica
outra conta Shopee ou um rótulo/alias do ERP antes de definir a cobertura da
operação. Se for outra conta, precisa de autorização própria; não presumir
que um token atende as duas lojas.

A análise direta local de 08/10 (resumo histórico registrado no evidence.json)
já mediu vendas e Ads da conta Giracasa por API: 11.285 pedidos válidos e
R$ 772.579,60 brutos em 08/09–07/10; R$ 64.371,54 de Ads na mesma janela.
É evidência histórica de atividade e acesso, não valor de outubro nem saldo
atual da carteira. Essa coleta local não foi importada no produto.

## Fontes que estão presentes e limites de margem

A Análise Comercial tem os 13 dias de outubro processados e atualização
de 13/10 às 10h11 BRT. O fiscal usa itens da NF como fallback e mantém receita
disponível. No snapshot fiscal de outubro, R$ 42.087,93 da receita estão sem
custo resolvido e R$ 58.766,28 sem parâmetros de comissão. São lacunas
distintas e podem se sobrepor; não somar as duas como perda.

O catálogo também tem 660 linhas fiscais de outubro cujo `product_id` não
encontra um produto carregado, distribuídas por 42 SKUs. A cobertura fiscal de
itens não significa cobertura completa de cadastro, custo ou lucro.

## Ordem de correção e critérios de aceite

1. **Recuperar itens Olist.** Preparar a fila Giracasa desde 08/09, com
   `giracasa.prepare_olist_order_item_backfill_queue_by_orders(start,end)`, e
   consumir com datas iguais às da fila e `limit` reconhecido pela função.
   Trabalhar em lotes limitados, acompanhar 429 e tempo de execução, e ligar a
   busca de detalhes dos pedidos correntes. Validar a cobertura com o mesmo
   critério de cancelamento do cache.
2. **Recalcular após a recuperação.** Atualizar os caches de quantidade,
   vendas e SKUs para os dias recuperados. Não aplicar a receita da NF sobre
   a série comercial como se fossem a mesma métrica. Previsão e recomendações
   devem ficar indisponíveis quando as semanas-base não permitem cálculo.
3. **Completar Shopee por conta.** Validar importação de pedidos, catálogo,
   FBS e escrow da conta própria; preparar os jobs e a carga por loja em
   janelas de até 14 dias quando o endpoint exigir. Reconciliação precisa de
   cursores duráveis separados para carteira e pendências. Confirmar a conta
   Vari Útil antes de integrar seus dados.
4. **Completar Ads e devoluções.** Portar a RPC Ads para o schema Giracasa,
   revisar a função de coleta atual e confirmar cobertura por loja/dia antes
   de liberar a página. Carregar devoluções e agendar o cache de vínculo à NF
   de venda. Manter os dados financeiros/pessoais restritos a `service_role`.
5. **Corrigir mensagens e Status.** Exibir ausência de coleta e atraso de
   fonte, sem transformar ausência em zero ou confirmação financeira. Medir
   cobertura comercial além de `refreshed_at`; distinguir integração ainda não
   configurada de execução falha. Revisar o suporte ao Full em SP antes de
   consultar suas tabelas. Remover ou delimitar exemplos históricos de MG.
6. **Conectar e validar Mercado Livre/SP.** Depende da conta própria. Nunca
   preencher SP com anúncios, tokens, vendas ou saldos de Uberlândia.

Aceite: janela fechada comparada à fonte própria; itens comerciais com
cobertura medida; recuperação histórica e atualização corrente comprovadas;
forecast sem zeros decorrentes de lacuna; reconciliação com repasses reais e
posição de carteira datada; Ads com coleta completa; devoluções com cobertura
declarada; Status refletindo cada produtor. Novos objetos precisam de
`COMMENT ON`, isolamento por operação e crons com saúde visível.

## Validação e continuidade

As consultas fiscais, de SKUs e forecast foram repetidas sob o papel
`authenticated`, com as claims de um usuário já autorizado a Giracasa:
7.305 NFs e R$ 474.804,35 disponíveis, SKUs operacionais zerados e previsão
zerada. Logo, esses zeros não vêm de um bloqueio geral de RLS. O SELECT direto
de escrow continua negado ao papel comum, conforme o contrato de dado
financeiro/pessoal; não conceder esse acesso para tentar corrigir a tela.

O browser disponível não tinha sessão e redirecionou para login. A referência
06/10 do print de Status não foi reproduzida em sessão autenticada e não foi
atribuída a uma causa de cache sem evidência. As falhas de fontes e de tabelas
foram confirmadas diretamente no banco e no código.

Na auditoria inicial não houve alterações de produção. Após a autorização do
usuário, as correções e o manifesto de novidades foram implementados conforme
o registro no início deste documento.
