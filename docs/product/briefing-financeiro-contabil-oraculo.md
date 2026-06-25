# Briefing financeiro e contabil - Oraculo

Data: `2026-06-25`

## Objetivo deste documento

Este documento serve para alinhar com o responsavel pelo financeiro e contabil:

- o que e o Oraculo;
- em que etapa o projeto esta;
- quais numeros ja entram automaticamente via Olist e marketplaces;
- quais dados dependem de validacao financeira/contabil;
- o que precisamos definir para calcular margem, lucro, ROI e alertas com seguranca.

## O que e o Oraculo

O Oraculo e a camada central de inteligencia operacional e financeira da operacao.

Ele consolida dados de venda, estoque, produtos, canais e notas fiscais em uma base unica no Supabase e disponibiliza isso em um painel web para leitura rapida da diretoria.

O objetivo nao e apenas mostrar faturamento. O objetivo e responder com rapidez:

- o que esta vendendo;
- o que parou de vender;
- qual canal esta performando melhor;
- quais produtos estao com risco de ruptura;
- quais SKUs geram margem boa ou ruim;
- onde a operacao esta ganhando ou perdendo dinheiro.

## Premissa oficial ja validada

Hoje a premissa oficial do Oraculo e fiscal:

- venda oficial = NF faturada de saida;
- receita oficial = valor total das NFs emitidas/autorizadas;
- item vendido para margem/ROI = item vinculado a NF emitida.

Regra fiscal validada contra a tela da Olist:

- considerar status `6` e `7`;
- excluir `tipo = E`;
- excluir devolucao;
- usar data de emissao da NF como data oficial;
- usar o valor total validado da NF como receita oficial.

Validacao feita no periodo `2026-06-01` a `2026-06-19`:

- Olist: `71.197` NFs emitidas e `R$ 5.243.629,96`;
- Oraculo/Supabase: `71.198` NFs e `R$ 5.243.715,76`.

A diferenca ficou dentro da tolerancia e a camada fiscal foi aprovada.

## O que ja entra automaticamente no sistema

Hoje o Oraculo ja puxa automaticamente:

- pedidos da Olist;
- notas fiscais da Olist;
- produtos e estoque da Olist;
- dados de canais/marketplaces;
- dados de Shopee Donacor em modo somente leitura;
- usuarios, login e parametros operacionais no frontend.

## O que ainda nao vem pronto da Olist ou dos marketplaces

Para margem, lucro, ROI e alertas financeiros, parte da informacao nao vem pronta ou nao vem com confianca suficiente via API.

Esses dados precisam ser definidos com o financeiro/contabil e serao cadastrados manualmente no frontend do Oraculo.

## O que precisamos validar com o financeiro/contabil

Precisamos sair da conversa com as regras oficiais abaixo.

### 1. Conceito oficial de margem

Definir qual margem o Oraculo deve mostrar:

- margem de contribuicao;
- margem bruta;
- margem liquida operacional;
- outra leitura oficial da empresa.

Precisamos definir exatamente o que entra e o que nao entra no calculo.

### 2. Estrutura oficial de custos por produto

Precisamos saber qual sera a fonte oficial do custo unitario:

- custo medio;
- ultimo custo de compra;
- custo contabil;
- custo de reposicao;
- custo com imposto recuperavel separado ou embutido.

Tambem precisamos definir a frequencia de atualizacao:

- manual;
- semanal;
- mensal;
- por nova compra.

### 3. Impostos por UF e por operacao

Precisamos validar como tratar:

- ICMS;
- FCP;
- DIFAL;
- PIS/COFINS, se entrar na leitura desejada;
- substituicao tributaria, se aplicavel;
- diferenca de tributacao por estado;
- diferenca por tipo de operacao;
- diferenca por canal, se existir regra especifica.

O sistema ja possui uma area de parametros por UF, mas essas aliquotas ainda precisam ser confirmadas pelo financeiro/contabil.

### 4. Taxas por canal

Precisamos da regra oficial de custos variaveis por canal:

- comissao do marketplace;
- taxa de pagamento;
- tarifa fixa por pedido;
- frete subsidiado pela empresa;
- custo operacional por pedido;
- embalagem por item ou por pedido.

### 5. Politica oficial de ROI

Precisamos definir a formula de ROI que a empresa quer usar.

Exemplos de decisao que precisam ser fechadas:

- ROI sobre custo do produto apenas;
- ROI sobre custo total colocado;
- ROI com ou sem imposto;
- ROI com ou sem frete subsidiado;
- ROI por SKU ou por pedido;
- ROI minimo aceitavel;
- ROI meta;
- faixa de alerta.

### 6. Regras de alerta

Precisamos transformar a regra financeira em alerta pratico no sistema.

Exemplos:

- margem abaixo do minimo;
- margem abaixo da meta;
- ROI abaixo do minimo;
- produto vendendo com ganho insuficiente;
- canal com taxa acima do previsto.

## Parametros que o Oraculo espera receber

O frontend do Oraculo ja tem base para cadastro manual de parametros. O que precisamos preencher com apoio do financeiro/contabil e:

### Parametros por SKU

- SKU;
- custo unitario oficial;
- margem meta;
- margem minima;
- observacao sobre excecao fiscal ou comercial.

### Parametros por canal

- canal/fonte;
- comissao;
- taxa de pagamento;
- frete subsidiado;
- embalagem;
- margem meta;
- margem minima.

### Parametros por UF

- UF;
- tipo de operacao;
- ICMS;
- FCP;
- DIFAL;
- taxa efetiva, se a empresa preferir trabalhar com taxa consolidada;
- vigencia da regra.

## Perguntas objetivas para a reuniao

Estas sao as perguntas que precisamos responder.

1. Qual e a definicao oficial de margem que a diretoria quer ver no Oraculo?
2. Qual e a fonte oficial do custo unitario por SKU?
3. O custo deve entrar com ou sem credito de imposto?
4. Quais impostos devem entrar no calculo da margem operacional?
5. A regra tributaria sera cadastrada por UF, por operacao ou por ambos?
6. Existe diferenca relevante de taxa/comissao por canal que precisa entrar no calculo?
7. Frete subsidiado entra no calculo? Se sim, por pedido ou por item?
8. Embalagem e custo operacional entram no calculo? Como ratear?
9. Qual formula oficial de ROI a empresa quer adotar?
10. Quais faixas devem acionar alerta de margem e ROI?

## Decisoes que queremos sair da reuniao

Ao final da conversa, o ideal e sair com:

- definicao oficial de margem;
- definicao oficial de ROI;
- fonte oficial de custo do SKU;
- regra de impostos por UF/operacao;
- regra de taxas por canal;
- regra de frete subsidiado e embalagem;
- faixas de alerta para margem e ROI;
- responsavel por manter esses parametros atualizados.

## Como isso vira sistema

Depois da validacao com o financeiro/contabil, faremos:

1. cadastrar os parametros oficiais no frontend do Oraculo;
2. aplicar esses parametros nas views de margem e ROI;
3. auditar os calculos com alguns SKUs reais;
4. liberar leitura oficial por produto;
5. ativar alertas de margem e desempenho.

## Resultado esperado para a diretoria

Com essa etapa concluida, o Oraculo passara a mostrar de forma rapida e confiavel:

- receita fiscal oficial;
- quantidade faturada;
- margem por SKU;
- ROI por SKU;
- produtos que vendem bem mas deixam pouca margem;
- produtos com margem abaixo da meta;
- produtos com boa saida e boa rentabilidade;
- canais que trazem volume com ou sem rentabilidade adequada.

## Observacao importante

Neste momento, o Oraculo ja tem a camada fiscal oficial validada no nivel de nota fiscal.

O proximo passo nao e mais descobrir faturamento. O proximo passo e definir corretamente os parametros financeiros e tributarios para transformar faturamento em leitura confiavel de margem e ROI.
