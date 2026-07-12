# Oráculo — Manual da Plataforma

**Guia para diretoria e treinamento · Grupo Jacartta · Julho 2026**

---

## 1. O que é o Oráculo

O Oráculo é a plataforma de inteligência de vendas do Grupo Jacartta. Ele reúne, em um só lugar, as vendas de todos os canais (Olist e Shopee), calcula automaticamente impostos, custos, lucro e margem de cada operação, e transforma isso em painéis simples de ler.

**O princípio central: o número oficial é a nota fiscal.** A receita que o Oráculo mostra não vem de pedidos criados, e sim de **NFs emitidas e autorizadas** — o mesmo critério do fisco e da contabilidade. Pedido pode ser cancelado; nota emitida é venda de verdade.

- **Acesso**: oraculo.oliverhome.com.br, com login individual por usuário.
- **Atualização**: automática, ao longo de todo o dia. O selo **"Sync fiscal saudável"** (verde) no topo indica que os dados chegam até hoje; se aparecer "Dados até [data]", é até onde os números vão.
- **Período**: por padrão, o mês corrente. Dá para escolher qualquer período nos campos de data.

## 2. Como ler os números — 5 conceitos

1. **NF válida** — nota emitida/autorizada, de saída, sem devolução. É o que entra na receita. Canceladas e devoluções aparecem em cards próprios, fora da receita.
2. **Visão fiscal × visão por pedidos** — a visão fiscal (oficial) conta pela data de **emissão da nota**; a visão por pedidos (auxiliar) conta pela data do **pedido**. Elas nunca batem exatamente, e está certo assim. Decisão de negócio usa a fiscal.
3. **Cobertura** — nem toda venda já tem o custo do produto identificado no sistema. A "cobertura" diz que fatia da receita tem custo confiável. A margem mostrada é calculada **só sobre essa fatia** — é parcial, mas honesta. A cobertura cresce todo dia conforme o sistema processa as notas.
4. **O que a margem fiscal NÃO inclui** — comissão de marketplace, frete e anúncios (ads) não entram no cálculo da margem fiscal. Ela responde "quanto sobra depois de custo e impostos". Para simular o preço com comissão e frete, existe a **Calculadora**.
5. **Setinhas e curvas nos cards** — cada card importante mostra uma **curva** (evolução dia a dia) e uma **setinha de variação**: ▲ verde = melhorou, ▼ vermelha = piorou. A comparação é justa: mês atual contra o **mesmo trecho** do mês anterior (12 dias contra 12 dias). Nos cards de custo e impostos a cor inverte — subir custo é vermelho, mesmo com setinha para cima.

## 3. As áreas da plataforma

| Área | Para que serve |
|---|---|
| **Analytics** | Página principal: receita, margem, ROI, gráficos e ranking do mês |
| **Pedidos** | Operação do dia a dia por data de pedido (visão auxiliar) |
| **SKUs** | Desempenho produto a produto: receita, margem, estoque |
| **Curva de Venda** | Classificação A/B/C por giro (tempo desde a última venda) |
| **Curva de Estoque** | Classificação A/B/C por cobertura (meses de estoque) |
| **Calculadora** | Simulador de precificação por marketplace |
| **Alertas** | Produtos que exigem ação: ruptura, risco de ruptura, parados |
| **Parâmetros** | Cadastro manual de custos e taxas por canal/SKU/UF |
| **Usuários / Status** | Administração de acessos e saúde da sincronização |

## 4. Analytics — a página principal

### 4.1 Fiscal oficial (primeiros cards)

| Card | O que significa |
|---|---|
| **Receita faturada** | Soma das NFs válidas do período. O número oficial de venda. |
| **NFs emitidas** | Quantidade de notas válidas. |
| **Ticket médio faturado** | Receita ÷ número de NFs. Valor médio por nota. |
| **NFs com pedido** | Notas já vinculadas ao pedido de origem (rastreabilidade). |
| **Canceladas** | Notas canceladas — valor exibido está **fora** da receita. |
| **Devoluções excluídas** | Devoluções identificadas — também fora da receita. |
| **SKU fiscal em processamento** | % das notas cujos itens já foram identificados (a "cobertura" crescendo). |

### 4.2 Margem e ROI fiscais

Calculados com as regras tributárias reais do grupo (Lucro Real com RET, perfil Jacartta), produto a produto, nota a nota. Kits são abertos em componentes para buscar o custo correto.

| Card | Fórmula em palavras |
|---|---|
| **Receita com custo** | A fatia da receita cujo custo de produto é confiável (a base do cálculo). |
| **Custo do produto** | Soma dos custos dos itens vendidos (kits abertos por componente). |
| **Impostos** | ICMS + PIS/COFINS + DIFAL das vendas cobertas. |
| **Lucro fiscal** | Receita com custo − custo do produto − impostos. |
| **Margem fiscal** | Lucro ÷ receita com custo. "De cada R$ 100 vendidos, quanto sobra." |
| **ROI fiscal** | Lucro ÷ custo. "Para cada R$ 1 investido em produto, quanto volta." |

Ao lado, o **donut de impostos** mostra a composição da carga (quanto é DIFAL, quanto é PIS/COFINS, quanto é ICMS) e os **medidores** dão a leitura rápida de margem e ROI.

### 4.3 Gráficos e ranking

- **Curva fiscal do período** — receita por dia, com a linha tracejada dourada marcando a **média diária** e o pico destacado.
- **Receita por canal** — quanto veio de cada marketplace/loja.
- **Ranking de SKUs** — os produtos que mais faturam (clique leva ao detalhe).
- **Operacional auxiliar** — pedidos, itens e ticket pela data do pedido. Útil para a operação, mas **não é o número oficial**.
- **Exportar** — botão dourado no topo baixa a planilha da receita diária do período.

## 5. SKUs — desempenho por produto

Cada linha é um produto, com duas leituras de margem lado a lado:

- **Margem operacional (30 dias)** — baseada nos parâmetros cadastrados manualmente (página Parâmetros). Visão rápida de saúde.
- **Margem fiscal (mês)** — calculada pelas regras oficiais, com decomposição completa no painel de detalhe: receita, custo, ICMS, PIS/COFINS, DIFAL e lucro do SKU.

O **status de margem** resume a saúde: **Saudável** (verde), **Atenção** (amarelo), **Crítico** (vermelho), além de "Sem custo"/"Configurar" quando falta cadastro. **Todas as tabelas da plataforma ordenam ao clicar no título da coluna** — clique em "Receita" para ver os maiores, clique de novo para inverter.

## 6. Curvas A/B/C

**Curva de Venda (giro)** — classifica os produtos em estoque pelo tempo desde a última venda:
- **A** — vendeu nos últimos 3 meses (giro bom)
- **B** — entre 3 e 6 meses sem venda (atenção)
- **C** — mais de 6 meses sem venda (candidato a promoção/desova)

**Curva de Estoque (cobertura)** — classifica pelo tempo que o estoque atual dura no ritmo médio de venda:
- **Cobertura (meses) = estoque atual ÷ média mensal de vendas**
- **A** — até 3 meses de cobertura (estoque enxuto; atenção à reposição)
- **B** — 3 a 6 meses (confortável)
- **C** — mais de 6 meses (capital parado em estoque)

Leitura combinada: produto **curva A de venda** com **pouca cobertura** = repor com urgência. Produto **curva C de venda** com **muita cobertura** = dinheiro parado.

## 7. Calculadora de Precificação

Responde à pergunta: **"por quanto preciso vender para cobrir custos, taxas e impostos e ainda ter lucro?"** Funciona para produto unitário e para kits.

- **Dois modos**: informo o **markup** (multiplicador sobre o custo) e ela devolve o preço; ou informo o **preço** e ela devolve o markup e o lucro.
- **Marketplace selecionável**: Shopee, Mercado Livre Clássico, Mercado Livre Premium e TikTok Shop — cada um com suas comissões e taxas fixas por faixa de preço já preenchidas (e editáveis, pois comissão varia por categoria).
- **Resultado**: preço de venda, lucro líquido, margem líquida, markup aplicado e a decomposição "para onde vai o preço" (custo, comissão, impostos, ads, reembolso).
- **Status**: **Rentável** (verde), **Margem baixa** (amarelo, abaixo de 10%) ou **Prejuízo** (vermelho).

Fórmulas em palavras: **preço = custo total × markup** · **lucro = preço − (custo + comissão do marketplace + impostos + ads + custo fixo + reembolso médio)** · **margem = lucro ÷ preço**.

*Importante: a Calculadora usa taxas simplificadas e editáveis — é um norte para decidir preço. A margem real, apurada nota a nota, está na página SKUs.*

## 8. Alertas

A página lista os produtos que exigem ação, do mais urgente para o menos:

- **Ruptura** — estoque zerou e o produto vende. Perdendo venda agora.
- **Ruptura iminente** — no ritmo atual, o estoque acaba em poucos dias. A coluna **Cobertura** diz quantos ("7d" = uma semana de estoque).
- **Parado / Sem venda** — tem estoque mas não gira.

O **número vermelho ao lado de "Alertas" no menu** é a contagem de itens acionáveis (ruptura + iminente) — o mesmo número em todas as telas.

## 9. Fórmulas — resumo de bolso

| Indicador | Cálculo |
|---|---|
| Receita fiscal | Soma das NFs válidas (emitidas/autorizadas, saída, sem devolução) |
| Ticket médio | Receita ÷ quantidade de NFs |
| Lucro fiscal | Receita com custo − custo do produto − impostos |
| Margem fiscal | Lucro fiscal ÷ receita com custo |
| ROI fiscal | Lucro fiscal ÷ custo do produto |
| Impostos | ICMS + PIS/COFINS + DIFAL |
| Cobertura de custo | Receita com custo confiável ÷ receita total |
| Cobertura de estoque | Estoque atual ÷ média mensal de vendas (em meses) |
| Preço (calculadora) | Custo total × markup |
| Lucro (calculadora) | Preço − custo − comissão − impostos − ads − fixos − reembolso |
| Variação (▲/▼) | Mês atual vs mesmo trecho do mês anterior |

## 10. Checklist de leitura (reunião semanal)

1. O selo **"Sync fiscal saudável"** está verde? (Se não, os números param na data indicada.)
2. **Receita faturada** e a setinha: crescendo contra o mesmo trecho do mês passado?
3. **Margem e ROI fiscais**: dentro da meta? A curva dos últimos dias aponta para onde?
4. **Cobertura**: subiu? (Margem sobre cobertura maior = leitura mais fiel.)
5. **Alertas**: quantas rupturas? Priorizar reposição pelos SKUs de maior receita.
6. **Curva C de estoque**: quanto capital está parado? Vale ação comercial?

## Glossário

- **NF** — nota fiscal. **NF válida**: emitida/autorizada, de saída, sem devolução.
- **SKU** — código único de produto.
- **Ticket médio** — valor médio por nota (ou por pedido).
- **Markup** — multiplicador sobre o custo (custo R$ 50 × markup 2,5 = preço R$ 125).
- **Margem** — % do preço que vira lucro.
- **ROI** — retorno sobre o custo investido no produto.
- **ICMS / DIFAL** — impostos estaduais sobre a venda (DIFAL é a diferença de alíquota entre estados).
- **PIS/COFINS** — impostos federais; no Lucro Real, calculados sobre o valor agregado.
- **Curva A/B/C** — classificação de prioridade (A = melhor situação, C = pior).
- **Ruptura** — estoque zerado de produto que vende.
- **Cobertura** — quanto tempo (ou que fatia) algo alcança: estoque em dias/meses, ou receita com custo identificado.
- **Em processamento (backfill)** — notas cujos itens o sistema ainda está identificando; viram cobertura ao longo dos dias.

---

*Documento de treinamento — Oráculo · Grupo Jacartta. Dúvidas e sugestões: time de dados.*
