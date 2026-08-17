# Como o Oráculo calcula ICMS, PIS/COFINS, DIFAL e comissão

Documento de apoio para explicar a camada fiscal: **de onde vem cada dado, qual é a
fórmula, como aparece na tela e o que ainda precisa de validação do contador.**

**Versão 6 · 14/08/2026.** Números reais deste documento: período
**01–14/08/2026** e amostra de linhas de **01/08/2026**. Versões anteriores
descreviam regras já revogadas (PIS/COFINS com crédito de custo, DIFAL dentro de
MG, base pelo valor do pedido, DIFAL por dentro, custo bruto) — descarte-as.

> **Revisão de 14/08/2026 (2ª) — o custo virou líquido.** O custo do produto passou
> a descontar os créditos recuperáveis: **−9,25% no nacional** e **−11,75% no
> importado**. No período, o custo caiu de R$ 1.996.913,36 para **R$ 1.777.481,69**
> e a margem foi de −1,30% para **+4,44%**. Ver `docs/adr/ADR-005-custo-liquido-creditos.md`.
>
> **Somando as duas mudanças do dia, a margem do período saiu de −5,16% para
> +4,44% sem que uma única venda mudasse.** A operação coberta passa a aparecer
> positiva porque a régua mudou, não porque o negócio mudou — é a leitura honesta
> a dar para a diretoria.
>
> **Revisão de 14/08/2026 (1ª) — o DIFAL mudou de fórmula.** Por orientação do contador
> (Eduardo Faleiros), o DIFAL deixou de usar a base "por dentro" da LC 190/2022 e
> passou a ser a **diferença simples de alíquotas**: `base × (interna − interestadual)`.
> Continua existindo só em operação interestadual. Efeito no período 01–14/08: o
> DIFAL caiu de R$ 570.891,62 para **R$ 423.249,36** (−25,9%), o imposto total caiu
> 14,3% e a margem da base coberta subiu de **−5,16% para −1,30%**. O prejuízo
> encolheu 75%, mas não virou lucro. Ver `docs/adr/ADR-004-difal-diferenca-aliquotas.md`.
>
> **Revisões de 04/08/2026** — o motor foi corrigido em duas rodadas, validado
> contra a NF real 533740 (Shopee, MG→RJ): (1) entrou a **comissão do marketplace**,
> que absorve frete, ads, embalagem e despesa operacional; (2) a base virou o
> **valor faturado na NF** (não o do pedido) e o PIS/COFINS virou débito bruto
> (custo não entra em imposto).

---

## 0. Antes de tudo: existem DOIS motores diferentes no Oráculo

Isso é a primeira coisa a alinhar, porque os dois falam "ICMS", "DIFAL" e "comissão"
e não são a mesma conta.

| | **Motor fiscal** (Dashboard "Margem e ROI fiscais" + /skus) | **Calculadora** (/calculadora) |
|---|---|---|
| Para que serve | Medir o que **já aconteceu** (nota emitida) | Simular **preço antes de vender** |
| Base de cálculo | **Valor faturado na NF** (rateado por item) | Preço digitado |
| ICMS | Por UF e origem do produto | Campo fixo editável (padrão 1,3%) |
| DIFAL | Diferença de alíquotas, só interestadual | Campo fixo editável (padrão 6%) |
| PIS/COFINS | 9,25% sobre a NF, sem crédito | 9,25% sobre o valor agregado |
| Comissão de marketplace | Faixa do canal da NF | Faixa do marketplace escolhido na tela |
| Frete, ads, embalagem | **Embutidos na comissão** | Ads e custo fixo em linhas próprias |

A calculadora é um "norte" de precificação, simplificada de propósito. **Nada do que
se muda nela afeta o dashboard.** O resto deste documento fala do motor fiscal.

---

## 1. De onde vem o dado — a cadeia

O motor fiscal não inventa nada: ele parte da **nota fiscal** e vai puxando o resto.

```
NF válida (Olist)
   └─ vinculada a um PEDIDO
        └─ ITENS do pedido  →  receita, quantidade, SKU
             └─ PRODUTO      →  custo unitário e origem (nacional/importado)
   └─ UF do destinatário     →  ICMS e DIFAL
   └─ CANAL da venda         →  comissão do marketplace
```

**O que é "NF válida":** status `6` ou `7` (autorizada/emitida), tipo diferente de
`E` (entrada) e origem diferente de `devolucao`. NF cancelada (status `8`) é contada
à parte e não entra em receita.

**Cada campo, um por um:**

| Campo | Origem exata |
|---|---|
| **Receita do item** | `vNF` da nota (`olist_invoices.fiscal_amount`), **rateado** pelas linhas do pedido na proporção do valor de cada item |
| Quantidade | `olist_order_items.quantidade` |
| UF de destino | `olist_invoices.uf` — **vem da NF**, não do cadastro do cliente |
| Canal da venda | `olist_invoices.fiscal_channel_label` (ex.: "Shopee toca", "Mercado Livre Fulfillment") |
| Origem (nacional/importado) | `olist_products.payload->>'origem'` — `'1'` = importado, resto = nacional |
| Custo unitário | `preco_custo_medio` do produto; se for zero, cai para `preco_custo` — **líquido de créditos** (seção 1.1) |
| Custo de **kit** (tipo K) | Soma dos componentes: `quantidade × custo líquido do componente`, cada um com a origem dele |

### 1.1 O custo é líquido dos créditos recuperáveis

Desde 14/08/2026, o custo que entra na conta não é o do cadastro: é o que sobra
depois do crédito que volta na apuração.

| Origem | Crédito | Fator |
|---|---:|---:|
| Nacional | 9,25% (PIS/COFINS não cumulativo) | × 0,9075 |
| Importado | 11,75% (PIS/COFINS-Importação: 2,1% + 9,65%) | × 0,8825 |

Exemplo real: o SKU 213875 (pote de vidro marmita branco 370ml, **importado** no
cadastro) tem custo R$ 3,93 no ERP e entra na margem por **R$ 3,47**.

Três coisas que essa regra fixa:

- **Kit desconta por componente**, com a origem de cada um — um kit pode misturar
  nacional e importado.
- **O override manual de `/parametros` é custo BRUTO**: quem digita informa o que
  pagou, o sistema desconta o crédito. A regra é a mesma venha o número de onde vier.
- **Não há dupla contagem.** O crédito aparece só aqui; o PIS/COFINS da seção 2.2
  continua sendo o débito bruto que a NF destaca. Em lucro dá no mesmo — a
  diferença é que o imposto exibido continua conferindo com a nota.

A mesma função (`oraculo_net_cost`) alimenta o motor fiscal, as páginas de Shopee
e Mercado Livre e as devoluções, para que o custo não possa divergir entre telas.

**UF de origem da operação:** assumida como **MG** (matriz Jacartta). Não é lida do
banco — está fixa na regra.

### Por que a base é a NF, e não o pedido

Medido em 01/08: **30% das NFs saem com valor menor que o pedido** — o cupom do
vendedor fica registrado no pedido pelo preço cheio e a NF sai pelo valor pago.
A receita estava inflada 6,95% no dia (caso extremo: pedido R$ 149,90 → NF
R$ 51,89). O item da NF não serve de base direta (kit do pedido vira componentes
na NF, e o item da NF também carrega preço cheio, com o desconto só no total), por
isso o `vNF` é **rateado** proporcionalmente pelas linhas do pedido. O rateio ainda
conserta pedido com duas NFs, que antes contava a receita em dobro.

### Quando o custo é considerado "não confiável"

A linha é excluída da margem (fica sem lucro, sem margem, sem ROI) em 3 casos:

1. custo ≤ 0;
2. kit em que **algum** componente está sem custo;
3. custo líquido maior que **3× o preço de venda real** do item — trava de sanidade,
   porque o campo `preco` do Olist é placeholder para muitos SKUs.

Isso é intencional: **melhor não mostrar do que mostrar errado.**

---

## 2. As fórmulas

Tudo é calculado **linha a linha** (por item de nota) e só depois somado.
Base de cálculo = **valor faturado na NF**, rateado por item (seção 1).
**O custo do produto não entra em nenhum imposto** — nenhuma alíquota é calculada
sobre ele; ele só aparece na última linha, a do lucro, já líquido dos créditos
(seção 1.1).

### 2.1 ICMS de saída — matriz Jacartta

Não é a alíquota cheia da UF. É a matriz do regime da Jacartta (Lucro Real com RET),
portada do app Financeiro:

| Origem do produto | Venda para **MG** | Venda para **qualquer outra UF** |
|---|---|---|
| Nacional | **6%** | **1,3%** |
| Importado | **14%** | **1,3%** |

```
ICMS = receita_do_item × alíquota / 100
```

### 2.2 PIS/COFINS — sobre o valor da nota fiscal, e só

```
PIS    = valor da NF × 1,65%
COFINS = valor da NF × 7,60%
Total  = valor da NF × 9,25%
```

**O custo do produto NÃO entra nesta conta.** Nada é subtraído da base — é o
valor da nota, vezes a alíquota, ponto. Exatamente como a NF destaca (CST 01).

Na NF 533740: 44,51 × 1,65% = **0,73** (PIS) e 44,51 × 7,60% = **3,38** (COFINS) —
os mesmos valores impressos na nota.

O custo é dado de gestão interna e aparece uma única vez no motor: na linha do
lucro (seção 2.5).

### 2.3 DIFAL — diferença de alíquotas, só interestadual

Duas regras:

1. **Não existe DIFAL dentro de MG.** Venda MG→MG é operação interna — só ICMS.
2. Nas interestaduais, o imposto é a **diferença simples** entre a alíquota interna
   do destino e a interestadual nominal, aplicada sobre o valor da nota.

```
DIFAL = base_NF × máximo(0, interna_destino − interestadual)
```

Na NF 533740 (MG→RJ, vNF 44,51): 44,51 × (22% − 12%) = **R$ 4,45**.

> **Aqui o motor diverge da NF de propósito.** A nota imprime `vBCUFDest` 57,06 e
> `vICMSUFDest` **7,21** — ela usa a base "por dentro" da LC 190/2022
> (44,51 ÷ 0,78 = 57,06; 57,06 × 22% − 44,51 × 12% = 7,21). O motor usa a regra que
> o contador determinou em 14/08/2026 e calcula 4,45 para a mesma nota. É o mesmo
> tratamento que o ICMS já recebia: o painel mede a premissa do contador, não o
> campo da NF. Ver a ressalva 3 na seção 6.

**ICMS interno do destino** — da tela /parametros quando validado; senão, tabela
fixa das 27 UFs:

| | | | | | | |
|---|---|---|---|---|---|---|
| AC 19 | AL 20 | AP 18 | AM 20 | BA 20,5 | CE 20 | DF 20 |
| ES 17 | GO 19 | MA 22 | MT 17 | MS 17 | MG 18 | PA 19 |
| PB 20 | PR 19,5 | PE 20,5 | PI 21 | RJ 22 | RN 20 | RS 17 |
| RO 19,5 | RR 20 | SC 17 | SP 18 | SE 19 | TO 20 | |

**ICMS interestadual** (saindo de MG):

- produto **importado** → **4%**
- produto **nacional**, destino em **PR, RJ, RS, SC, SP** → **12%**
- produto **nacional**, demais UFs (inclusive ES) → **7%**

A NF 533740 confirma as duas pontas: `pICMSInter = 12%` (MG→RJ nacional) e RJ
interna 22% — os mesmos valores da tabela do motor.

### 2.4 Comissão do marketplace — inclui frete, ads e embalagem

Decisão do negócio (04/08/2026): em vez de criar uma linha para frete, outra para
ads, outra para embalagem e outra para despesa operacional, **tudo isso é tratado
como já embutido no desconto que o marketplace faz**. A comissão usa as faixas de
cada canal:

| Canal | Faixa (preço **unitário**) | % | Fixo por unidade |
|---|---|---|---|
| **Shopee** | ≤ 79,99 | 20% | R$ 4 |
| | 80–99,99 / 100–199,99 / 200–499,99 / acima | 14% | R$ 16 / 20 / 26 / 28 |
| **Mercado Livre** (Clássico) | ≤ 28,99 / ≤ 49,99 / ≤ 78,99 | 13% | R$ 6,25 / 6,50 / 6,75 |
| | acima de 78,99 | 13% | — |
| **TikTok Shop** | ≤ 78,99 / acima | 6% | R$ 4 / — |
| **Amazon** | única | 15% | — |
| **Shein** | única | 18% | — |
| **Kwai Shop** | única | 20% | R$ 4 |

```
comissão = receita × % + fixo × quantidade
```

A faixa é escolhida pelo **preço unitário**, não pelo total da linha, e o fixo
multiplica a quantidade — porque nos três marketplaces com degrau o fixo é cobrado
por unidade vendida e os limites do ML (28,99 / 49,99 / 78,99) são por unidade.

**As faixas são dado, não código** (tabela `oraculo_marketplace_fee_params`): dá para
corrigir uma alíquota no banco sem republicar o sistema.

**Canal sem faixa cadastrada não inventa comissão:** fica zerado e a receita é
reportada à parte, com aviso de que o lucro dessas linhas está superestimado. Hoje
todos os canais ativos têm faixa, então esse valor está em R$ 0.

### 2.5 Lucro, margem e ROI

```
Impostos = ICMS + PIS/COFINS + DIFAL
Lucro    = Receita − Custo − Impostos − Comissão
Margem   = Lucro ÷ Receita
ROI      = Lucro ÷ Custo
```

---

## 3. Exemplos reais

### O caso de referência — NF 533740, aberta no XML

A nota que calibrou o motor: emitida em 04/08/2026 pela Jacartta (Tiny ERP),
venda Shopee de MG para consumidora final no RJ, SKU 212961 (nacional), 1 un.,
**vNF R$ 44,51**, sem desconto. Cada campo do XML contra o que o motor calcula:

| Campo do XML | Na NF | No motor | Confere? |
|---|---|---|---|
| `vNF` (valor da nota) | 44,51 | base = 44,51 (rateio neutro: nota sem desconto) | ✓ |
| `vPIS` (1,65%) | 0,73 | 0,73 | ✓ |
| `vCOFINS` (7,60%) | 3,38 | 3,38 | ✓ (soma 4,11 vs 4,12 — a NF arredonda cada tributo antes de somar) |
| `vBCUFDest` (base do DIFAL) | 57,06 | não usada (a regra não faz gross-up) | difere **de propósito** (ressalva 3) |
| `vICMSUFDest` (DIFAL) | 7,21 | **4,45** (44,51 × 10 p.p.) | difere **de propósito** (ressalva 3) |
| `pFCPUFDest` (FCP) | 0,00 | não cobrado | ✓ |
| `vICMS` (destacado 12%) | 5,34 | **0,58** (1,3% efetivo do RET) | difere **de propósito** — nominal × efetivo (ressalva 1) |
| IBS/CBS (teste 2026) | 0,28 | ignorado (compensável com PIS/COFINS) | ✓ sem perda |

E o que a NF não mostra, o motor completa:

| Componente | Conta | Valor |
|---|---|---|
| Impostos (motor) | 0,58 + 4,12 + 4,45 | R$ 9,15 |
| Comissão Shopee | 44,51 × 20% + R$ 4 (unitário ≤ 79,99) | R$ 12,90 |
| Custo do produto | SKU 212961: 32,32 × 0,9075 (nacional) | R$ 29,33 |
| **Resultado** | 44,51 − 29,33 − 9,15 − 12,90 | **− R$ 6,87** |

> Esta nota continua sendo o documento de auditoria do motor — mas agora ela também
> mostra onde o motor **escolhe** divergir. Dois campos diferem da NF, os dois por
> decisão registrada: o **ICMS** (a NF destaca 12% nominal, o motor mede 1,3%
> efetivo do RET) e o **DIFAL** (a NF calcula por dentro, o motor usa a diferença de
> alíquotas por orientação do contador). PIS, COFINS e FCP batem campo a campo.

### E no dia a dia — notas de 01/08/2026

Em 01/08, **1.742 das 4.169 linhas cobertas (41,8%) operam no prejuízo** quando
medidas pelo valor realmente faturado. Os três exemplos abaixo são notas reais.

### A — Shopee · nacional · MG
SKU 212961 · 1 un. · pedido R$ 43,62 → **NF R$ 33,62** (cupom do vendedor) · custo bruto R$ 32,32

| Componente | Conta | Valor |
|---|---|---|
| ICMS | 33,62 × 6% (MG, nacional) | R$ 2,02 |
| PIS/COFINS | 33,62 × 9,25% | R$ 3,11 |
| DIFAL | venda dentro de MG | R$ 0,00 |
| Impostos | | R$ 5,13 |
| **Comissão Shopee** | 33,62 × 20% + R$ 4 | **R$ 10,72** |
| Custo líquido | 32,32 × 0,9075 | R$ 29,33 |
| **Resultado** | 33,62 − 29,33 − 5,13 − 10,72 | **− R$ 11,56** |

> O produto foi vendido por R$ 33,62 com custo líquido de R$ 29,33 — a margem bruta
> era R$ 4,29 **antes** de qualquer imposto ou comissão, e a comissão sozinha come
> R$ 10,72. Nenhuma alíquota salva esse preço; a decisão aqui é de precificação,
> não fiscal.

### B — Mercado Livre · nacional · Ceará
SKU EDB60X60-50UN · 2 un. (R$ 64,90 cada) · NF = pedido R$ 129,80 · custo bruto R$ 67,12

| Componente | Conta | Valor |
|---|---|---|
| ICMS | 129,80 × 1,3% (fora de MG) | R$ 1,69 |
| PIS/COFINS | 129,80 × 9,25% | R$ 12,01 |
| DIFAL | 129,80 × (20% − 7%) | R$ 16,87 |
| Impostos | | R$ 30,57 |
| **Comissão ML** | 129,80 × 13% + R$ 6,75 × 2 un. | **R$ 30,37** |
| Custo líquido | 67,12 × 0,9075 | R$ 60,91 |
| **Resultado** | 129,80 − 60,91 − 30,57 − 30,37 | **+ R$ 7,95** |

> Esta linha é o retrato das duas mudanças de 14/08. Pelas regras da manhã (DIFAL
> por dentro R$ 23,36 e custo bruto R$ 67,12) a venda perdia R$ 4,75; pelas regras
> da tarde ela ganha R$ 7,95 — 6,1% de margem. Mesma nota, mesmo preço.

### C — TikTok Shop · importado · Rio
SKU 214013 · 1 un. · pedido R$ 149,90 → **NF R$ 51,89** (promoção) · custo bruto R$ 29,50

| Componente | Conta | Valor |
|---|---|---|
| ICMS | 51,89 × 1,3% | R$ 0,67 |
| PIS/COFINS | 51,89 × 9,25% | R$ 4,80 |
| DIFAL | 51,89 × (22% − 4%) | R$ 9,34 |
| Impostos | | R$ 14,81 |
| **Comissão TikTok** | 51,89 × 6% + R$ 4 (até 78,99) | **R$ 7,11** |
| Custo líquido | 29,50 × 0,8825 (**importado**) | R$ 26,03 |
| **Resultado** | 51,89 − 26,03 − 14,81 − 7,11 | **+ R$ 3,94** |

> Este era o "exemplo estrela" das versões anteriores: com o valor do pedido
> (R$ 149,90) aparecia margem de 47,6%. O comprador pagou R$ 51,89 e a venda fecha
> em R$ 3,94 (7,6%). É também o único dos três exemplos com o crédito de importado:
> 11,75% em vez de 9,25%.

### O mesmo produto, dois canais, no mesmo dia

SKU 212961, ambos para MG:

| | Shopee (1 un.) | Mercado Livre (2 un.) |
|---|---|---|
| Receita (NF) | R$ 33,62 | R$ 137,80 (R$ 68,90/un.) |
| Comissão | R$ 10,72 (**31,9%**) | R$ 31,41 (22,8%) |
| Resultado | **− R$ 11,56** | **+ R$ 26,71** (19,4%) |

> Mesmo produto, mesmo estado, mesmo dia: o canal e o preço praticado decidem entre
> perder R$ 11,56 e ganhar R$ 26,71. É esta comparação que o painel permite — e ela
> não depende de nenhuma das premissas fiscais que mudaram hoje, porque as duas
> vendas são dentro de MG (sem DIFAL) e do mesmo produto (mesmo crédito de custo).

---

## 4. Como isso aparece na tela

### 4.1 Dashboard — seção "Margem e ROI fiscais"

Sete cards + dois gráficos. Números reais de agosto/2026 (parcial, 01–14/08):

| Card | O que é | Valor |
|---|---|---|
| Receita com custo | Base coberta, pelo valor faturado na NF | R$ 3.824.984,51 |
| Custo do produto | Kits por componente, líquido de créditos | R$ 1.777.481,69 |
| Impostos | ICMS + PIS/COFINS + DIFAL | R$ 882.442,09 |
| **Comissão marketplace** | Inclui frete, ads e embalagem | **R$ 995.198,39** |
| Lucro fiscal | Receita − custo − impostos − comissão | **+ R$ 169.862,34** |
| Margem fiscal | Lucro ÷ receita coberta | **+4,4%** |
| ROI fiscal | Lucro ÷ custo | +9,6% |

**Para onde vai cada R$ 100 faturados:**

| | |
|---|---|
| Custo do produto | R$ 46,47 |
| Comissão do marketplace | R$ 26,02 |
| Impostos | R$ 23,07 |
| **Sobra** | **R$ 4,44** |

**Donut "Carga tributária do mês"** — a composição dos R$ 882.442,09 de imposto:

| | Valor | % dos impostos |
|---|---|---|
| **DIFAL** | R$ 423.250,34 | **48,0%** |
| PIS/COFINS | R$ 353.811,07 | 40,1% |
| ICMS | R$ 105.380,68 | 11,9% |

> **Duas mensagens do painel:** dentro dos impostos, o DIFAL ainda é o maior bloco
> (quase metade) mesmo depois da mudança de fórmula — não é o ICMS que pesa, é o
> diferencial das vendas interestaduais. E, olhando a conta inteira, **a comissão do
> marketplace é maior que todos os impostos somados** — R$ 26,02 contra R$ 23,07 a
> cada R$ 100. O maior custo depois do produto não é o governo, é o canal.

**Medidores "Margem e ROI"** — os mesmos percentuais em formato de gauge.

**Selo no cabeçalho:** `Cobertura X% da receita · parcial` — ver seção 5.

### 4.2 Página /skus — "Margem fiscal por SKU"

Ao clicar num SKU, abre o painel lateral com a mesma decomposição (ICMS,
PIS/COFINS, DIFAL, impostos, **comissão**, lucro, margem, ROI) só daquele SKU no mês.
Só existe para SKUs Olist, porque a conta vem da cadeia de notas.

### 4.3 Página /parametros

Duas tabelas, e é importante não confundir o que cada uma controla:

- **"Taxas, impostos e metas"** (por canal): alimenta a **margem operacional** (a
  outra seção do dashboard), **não** a fiscal.
- **"Imposto por UF"**: **passou a alimentar a margem fiscal** (04/08/2026). Antes a
  tela salvava e ninguém lia. Hoje ela tem 27 UFs × 2 origens, já preenchidas com as
  alíquotas que o motor aplica, todas como **Pendente**.

**Como funciona:** o motor só obedece à linha marcada como **Validado** e vigente na
data da nota. Linha pendente = regra padrão. Então revisar com o contador e marcar
"Validado" é o que faz a alíquota valer — sem mexer em código nem republicar o
sistema. Os campos:

| Campo | O que controla |
|---|---|
| ICMS de saída | O ICMS da venda. Em branco = matriz Jacartta (MG 6%/14%, demais 1,3%) |
| ICMS interno destino | Alimenta **só o DIFAL** |
| ICMS interestadual | Alimenta **só o DIFAL** |

Na tabela "Custo e exceções" da mesma tela, o campo **"Custo unitário bruto"** é o
custo de aquisição como foi pago: o sistema desconta o crédito sozinho (seção 1.1).
Digitar um valor já líquido faz o desconto acontecer duas vezes.

As faixas de comissão também são dado, mas ainda não têm tela — mudam no banco.

### 4.4 De onde a tela lê e com que frequência

- **Mês corrente** (visão padrão): lê um **snapshot pré-calculado**, regravado **de
  hora em hora, aos :15 min**, por um job no banco. Existe porque a conta ao vivo no
  mês inteiro estoura o tempo limite.
- **Período customizado**: calcula **ao vivo**. Se estourar o tempo, a seção mostra
  "temporariamente indisponível" em vez de exibir o mês errado.
- Histórico de 14 dias — alimenta os sparklines e as variações (▲▼) dos cards.

---

## 5. A cobertura — o ponto mais delicado da conversa

O motor só calcula quando consegue **fechar a cadeia inteira** (NF → pedido → item →
custo confiável). Hoje, em agosto:

| | |
|---|---|
| Receita fiscal oficial do período (NFs válidas) | **R$ 3.964.411,66** (61.663 NFs) |
| Receita com a conta fiscal completa | **R$ 3.824.978,14** |
| **Cobertura** | **96,5%** |

A correção de 09/08 (precedência híbrida de item: item do pedido e, na falta dele,
item fiscal da NF) resolveu o gargalo que travava a cobertura em 6% — o elo NF↔pedido
deixou de ser obrigatório. Ver `docs/fiscal-audit-jacartta-2026-08-09.md`.

**Como dizer isso:** *"a margem fiscal de +4,4% cobre 96,5% da receita faturada do
período — não é mais uma amostra, é o resultado."* O selo "parcial" no card continua
existindo enquanto o mês não fecha, e o rodapé segue declarando a cobertura — é um
contrato de honestidade deliberado do sistema, não um bug de exibição.

---

## 6. Ressalvas

1. **O ICMS de 1,3%/6%/14% é a carga efetiva do regime especial, não a da NF.** A
   NF destaca a alíquota nominal (a 533740 mostra 12% interestadual); o benefício
   de MG (crédito presumido do RET) acontece na apuração e reduz a carga ao efetivo.
   O motor mede o efetivo — **confirmar com o contador que o crédito presumido
   cobre todas as vendas.**
2. **PIS/COFINS está no débito bruto; o crédito aparece no custo.** O imposto
   exibido é o que a NF destaca. O crédito das entradas entra uma vez só, do lado
   do custo (seção 1.1) — não há dupla contagem. **Falta confirmar com o contador
   que o crédito é integral**: compra de fornecedor do Simples, produto monofásico
   ou com ST não geram 9,25% cheios, e a regra hoje é uniforme para o portfólio
   inteiro. Refino ainda em aberto: a **exclusão do ICMS destacado da base
   (Tema 69/STF)** — na NF 533740, o débito cairia de R$ 4,11 para R$ 3,62.
3. **O DIFAL é a diferença de alíquotas, não o valor da NF.** Desde 14/08/2026, por
   orientação do contador, o motor calcula `base × (interna − interestadual)`. A NF
   calcula por dentro (base única da LC 190/2022) e imprime um valor maior — na
   533740, R$ 7,21 contra R$ 4,45 do motor, ~38% de diferença. **A orientação está
   registrada apenas pela planilha de ICMS editada pelo contador; falta o parecer
   por escrito.** É a maior premissa em aberto do motor: o DIFAL é quase metade da
   carga tributária.
4. **Tudo depende da flag de origem do cadastro.** `payload->>'origem' = '1'`
   governa três coisas ao mesmo tempo: a alíquota de ICMS, a interestadual do
   DIFAL e agora o crédito descontado do custo (9,25% × 11,75%). Cadastro errado
   erra os três de uma vez.
5. **O custo é de aquisição, não posto no cliente**: frete de entrada, embalagem e
   armazenagem continuam fora. Quem carrega essas despesas é a comissão do
   marketplace (seção 2.4), que as absorve por decisão de 04/08.
6. **Sem substituição tributária e sem benefício por NCM**: a regra é uniforme por
   UF + origem, não olha o NCM nem o regime específico do produto.
7. **A comissão de Amazon, Shein e Kwai é tabelada, não medida.** Só a Shopee tem
   conferência contra dado real (ver abaixo). Amazon usa 15% (topo da faixa de
   casa/cozinha, por conservadorismo) e Kwai usa 20% + R$ 4 sem tabela pública
   oficial — vale confirmar no painel de cada seller. Juntos são ~0,9% da receita.
8. **A comissão não separa anúncio Clássico de Premium no ML.** Está tudo como
   Clássico (13%), confirmado pelo negócio.
9. **Reforma tributária já aparece na NF** (IBS 0,1% + CBS 0,9% em 2026): valor de
   teste, compensável com PIS/COFINS — ignorado no motor sem perda. Em 2027 a CBS
   cresce e o 9,25% terá de ser revisto.

### O que dá para afirmar com segurança

A comissão da **Shopee** — que é 87% da receita coberta — foi conferida contra o
**escrow real** que a Shopee devolve por pedido: o take rate efetivo medido é de
**27% a 34%** por loja/dia, e as faixas usadas produzem **28,5%**. Está dentro do
observado e ainda é conservador, porque o escrow não inclui ads nem subsídio de frete.

---

## 7. Onde está cada coisa no código

| O quê | Arquivo |
|---|---|
| Motor fiscal em produção (fonte de verdade) | `supabase/migrations/20260710093000_create_fiscal_margin.sql` |
| Comissão de marketplace na margem | `supabase/migrations/20260804140000_marketplace_fee_in_fiscal_margin.sql` |
| Faixas por canal (dado editável) | tabela `oraculo_marketplace_fee_params` |
| Alíquotas de ICMS vindas da tela | `supabase/migrations/20260804160000_state_tax_params_drive_fiscal_margin.sql` |
| Base NF + custo fora dos impostos | `supabase/migrations/20260804190000_fiscal_margin_nf_base_no_cost_in_taxes.sql` |
| Precedência híbrida de item (cobertura) | `supabase/migrations/20260809120000_fiscal_margin_hybrid_item_source.sql` |
| **DIFAL por diferença de alíquotas (regra vigente)** | `supabase/migrations/20260814120000_difal_diferenca_aliquotas.sql` |
| Decisão do DIFAL | `docs/adr/ADR-004-difal-diferenca-aliquotas.md` |
| **Custo líquido de créditos (regra vigente)** | `supabase/migrations/20260814150000_custo_liquido_creditos.sql` |
| Decisão do custo líquido | `docs/adr/ADR-005-custo-liquido-creditos.md` |
| Alíquota de crédito por origem | funções `oraculo_net_cost_rate` e `oraculo_net_cost` |
| Alíquotas por UF (dado editável) | tabela `oraculo_state_tax_params` |
| Mesmas regras em JS, com testes | `packages/domain/fiscal.js` + `fiscal.test.js` |
| Documentação das regras portadas | `docs/fiscal-financeiro-port.md` |
| Job horário que regrava o snapshot | `supabase/migrations/20260710190000_hourly_fiscal_snapshots.sql` |
| Leitura dos snapshots pelo site | `apps/web/lib/fiscal-snapshots.ts` |
| Cards e donut do dashboard | `apps/web/app/page.tsx` |
| Painel por SKU | `apps/web/app/skus/page.tsx` |
| Calculadora de precificação | `apps/web/app/calculadora/calculator.tsx` |

**Nota técnica:** SQL e JS calculam o DIFAL da mesma forma — `calcDifalDiferencaAliquotas`
espelha a função de produção e zera MG→MG; o mesmo vale para o custo líquido
(`calcNetCostByOrigin` × `oraculo_net_cost`). As regras revogadas continuam no
`fiscal.js` como especificação histórica, com testes próprios: `calcDifalPorDentro`
(base única da LC 190/2022, o que a NF traz impresso) e `calcDifal` (porte original
do app Financeiro, que ainda cobrava DIFAL dentro de MG).
