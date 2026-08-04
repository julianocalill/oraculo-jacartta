# Como o Oráculo calcula ICMS, PIS/COFINS, DIFAL e comissão

Documento de apoio para explicar a camada fiscal: **de onde vem cada dado, qual é a
fórmula, como aparece na tela e o que ainda precisa de validação do contador.**

**Versão 4 · 04/08/2026.** Números reais deste documento: snapshot de
**04/08/2026 14:28 UTC** (mês corrente 01–31/08) e amostra de linhas de
**01/08/2026**. Versões anteriores descreviam regras já revogadas (PIS/COFINS com
crédito de custo, DIFAL dentro de MG, base pelo valor do pedido) — descarte-as.

> **Revisões de 04/08/2026** — o motor foi corrigido em duas rodadas, validado
> contra a NF real 533740 (Shopee, MG→RJ): (1) entrou a **comissão do marketplace**,
> que absorve frete, ads, embalagem e despesa operacional; (2) a base virou o
> **valor faturado na NF** (não o do pedido), o PIS/COFINS virou débito bruto (custo
> não entra em imposto), e o DIFAL passou a ser **por dentro e só interestadual**.
> A margem da base coberta saiu de 32,6% (só tributos, base inflada) para **−5,5%**:
> medida pelos valores realmente faturados, a amostra coberta opera no prejuízo.

---

## 0. Antes de tudo: existem DOIS motores diferentes no Oráculo

Isso é a primeira coisa a alinhar, porque os dois falam "ICMS", "DIFAL" e "comissão"
e não são a mesma conta.

| | **Motor fiscal** (Dashboard "Margem e ROI fiscais" + /skus) | **Calculadora** (/calculadora) |
|---|---|---|
| Para que serve | Medir o que **já aconteceu** (nota emitida) | Simular **preço antes de vender** |
| Base de cálculo | **Valor faturado na NF** (rateado por item) | Preço digitado |
| ICMS | Por UF e origem do produto | Campo fixo editável (padrão 1,3%) |
| DIFAL | Por dentro, só interestadual | Campo fixo editável (padrão 6%) |
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
| Custo unitário | `preco_custo_medio` do produto; se for zero, cai para `preco_custo` |
| Custo de **kit** (tipo K) | Soma dos componentes: `quantidade × custo do componente` |

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
3. custo maior que **3× o preço de venda real** do item — trava de sanidade, porque
   o campo `preco` do Olist é placeholder para muitos SKUs.

Isso é intencional: **melhor não mostrar do que mostrar errado.**

---

## 2. As fórmulas

Tudo é calculado **linha a linha** (por item de nota) e só depois somado.
Base de cálculo = **valor faturado na NF**, rateado por item (seção 1).
**O custo do produto não entra em nenhum imposto** — é dado de gestão interna e
só aparece na última linha, a do lucro.

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

### 2.3 DIFAL — por dentro, só interestadual

Duas regras, ambas provadas pela NF real:

1. **Não existe DIFAL dentro de MG.** Venda MG→MG é operação interna — só ICMS.
2. Nas interestaduais, a base é **"por dentro"** (base única, LC 190/2022): o ICMS
   interno do destino é embutido na base antes de aplicar a alíquota.

```
base_destino = base_NF ÷ (1 − alíquota_interna_destino)
DIFAL        = máximo(0, base_destino × interna − base_NF × interestadual)
```

Conferindo com a NF 533740 (MG→RJ, vNF 44,51): base destino = 44,51 ÷ 0,78 =
**57,06** (é o `vBCUFDest` impresso na nota); DIFAL = 57,06 × 22% − 44,51 × 12% =
12,55 − 5,34 = **R$ 7,21** (é o `vICMSUFDest`). A fórmula antiga, sem o gross-up,
dava R$ 4,45 — subestimava ~40%.

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
| `vBCUFDest` (base do DIFAL) | **57,06** | 44,51 ÷ (1 − 22%) = **57,06** | ✓ |
| `vICMSUFDest` (DIFAL) | **7,21** | 57,06 × 22% − 44,51 × 12% = **7,21** | ✓ no centavo |
| `pFCPUFDest` (FCP) | 0,00 | não cobrado | ✓ |
| `vICMS` (destacado 12%) | 5,34 | **0,58** (1,3% efetivo do RET) | difere **de propósito** — nominal × efetivo (ressalva 1) |
| IBS/CBS (teste 2026) | 0,28 | ignorado (compensável com PIS/COFINS) | ✓ sem perda |

E o que a NF não mostra, o motor completa:

| Componente | Conta | Valor |
|---|---|---|
| Impostos (motor) | 0,58 + 4,12 + 7,21 | R$ 11,91 |
| Comissão Shopee | 44,51 × 20% + R$ 4 (unitário ≤ 79,99) | R$ 12,90 |
| Custo do produto | SKU 212961 | R$ 32,32 |
| **Resultado** | 44,51 − 32,32 − 11,91 − 12,90 | **− R$ 12,62** |

> É o documento de auditoria do motor: pegue o DANFE desta nota, confira campo a
> campo. O único número que difere da NF é o ICMS — e é deliberado: a NF destaca a
> alíquota nominal (12%), o motor mede a carga efetiva do regime especial (1,3%),
> que é o que sai do caixa após o crédito presumido.

### E no dia a dia — notas de 01/08/2026

Em 01/08, **215 das 302 linhas cobertas (71%) operam no prejuízo** quando medidas
pelo valor realmente faturado. Os três exemplos abaixo são notas reais.

### A — Shopee · nacional · MG
SKU 212961 · 1 un. · pedido R$ 43,62 → **NF R$ 33,62** (cupom do vendedor) · custo R$ 32,32

| Componente | Conta | Valor |
|---|---|---|
| ICMS | 33,62 × 6% (MG, nacional) | R$ 2,02 |
| PIS/COFINS | 33,62 × 9,25% | R$ 3,11 |
| DIFAL | venda dentro de MG | R$ 0,00 |
| Impostos | | R$ 5,13 |
| **Comissão Shopee** | 33,62 × 20% + R$ 4 | **R$ 10,72** |
| **Resultado** | 33,62 − 32,32 − 5,13 − 10,72 | **− R$ 14,55** |

> O produto foi vendido por R$ 33,62 com custo de R$ 32,32 — a margem bruta era
> R$ 1,30 **antes** de qualquer imposto ou comissão. Nenhuma alíquota salva esse
> preço; a decisão aqui é de precificação, não fiscal.

### B — Mercado Livre · nacional · Ceará
SKU EDB60X60-50UN · 2 un. (R$ 64,90 cada) · NF = pedido R$ 129,80 · custo R$ 67,12

| Componente | Conta | Valor |
|---|---|---|
| ICMS | 129,80 × 1,3% (fora de MG) | R$ 1,69 |
| PIS/COFINS | 129,80 × 9,25% | R$ 12,01 |
| DIFAL | 129,80 ÷ 0,80 × 20% − 129,80 × 7% | R$ 23,36 |
| Impostos | | R$ 37,06 |
| **Comissão ML** | 129,80 × 13% + R$ 6,75 × 2 un. | **R$ 30,37** |
| **Resultado** | | **− R$ 4,75** |

### C — TikTok Shop · importado · Rio
SKU 214013 · 1 un. · pedido R$ 149,90 → **NF R$ 51,89** (promoção) · custo R$ 29,50

| Componente | Conta | Valor |
|---|---|---|
| ICMS | 51,89 × 1,3% | R$ 0,67 |
| PIS/COFINS | 51,89 × 9,25% | R$ 4,80 |
| DIFAL | 51,89 ÷ 0,78 × 22% − 51,89 × 4% | R$ 12,56 |
| Impostos | | R$ 18,03 |
| **Comissão TikTok** | 51,89 × 6% + R$ 4 (até 78,99) | **R$ 7,11** |
| **Resultado** | | **− R$ 2,76** |

> Este era o "exemplo estrela" das versões anteriores: com o valor do pedido
> (R$ 149,90) aparecia margem de 47,6%. O comprador pagou R$ 51,89 — a venda
> real perde R$ 2,76. É o retrato do que a base errada escondia.

### O mesmo produto, dois canais, no mesmo dia

SKU 212961, ambos para MG:

| | Shopee (1 un.) | Mercado Livre (2 un.) |
|---|---|---|
| Receita (NF) | R$ 33,62 | R$ 137,80 (R$ 68,90/un.) |
| Comissão | R$ 10,72 (**31,9%**) | R$ 31,41 (22,8%) |
| Resultado | **− R$ 14,55** | **+ R$ 20,73** (15,0%) |

> Mesmo produto, mesmo estado: o canal e o preço praticado decidem entre perder
> R$ 14,55 e ganhar R$ 20,73. É esta comparação que o painel passa a permitir.

---

## 4. Como isso aparece na tela

### 4.1 Dashboard — seção "Margem e ROI fiscais"

Sete cards + dois gráficos. Números reais de agosto/2026 (parcial, dia 04):

| Card | O que é | Valor |
|---|---|---|
| Receita com custo | Base coberta, pelo valor faturado na NF | R$ 44.497,22 |
| Custo do produto | Kits expandidos por componente | R$ 22.880,16 |
| Impostos | ICMS + PIS/COFINS + DIFAL | R$ 12.126,22 |
| **Comissão marketplace** | Inclui frete, ads e embalagem | **R$ 11.928,11** |
| Lucro fiscal | Receita − custo − impostos − comissão | **− R$ 2.437,27** |
| Margem fiscal | Lucro ÷ receita coberta | **−5,5%** |
| ROI fiscal | Lucro ÷ custo | −10,7% |

**Para onde vai cada R$ 100 faturados:**

| | |
|---|---|
| Custo do produto | R$ 51,42 |
| Impostos | R$ 27,25 |
| Comissão do marketplace | R$ 26,81 |
| **Falta** | **− R$ 5,48** |

**Donut "Carga tributária do mês"** — a composição dos R$ 12.126,22 de imposto:

| | Valor | % dos impostos |
|---|---|---|
| **DIFAL** | R$ 6.928,57 | **57,1%** |
| PIS/COFINS | R$ 4.116,00 | 33,9% |
| ICMS | R$ 1.081,65 | 8,9% |

> **Duas mensagens do painel:** dentro dos impostos, o DIFAL é quase 2/3 — não é o
> ICMS que pesa, é o diferencial das vendas interestaduais. E, olhando a conta
> inteira, **a comissão do marketplace é maior que todos os impostos somados**.

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
| Receita fiscal oficial do mês (NFs válidas) | **R$ 741.281,34** (11.687 NFs) |
| Receita com a conta fiscal completa | **R$ 44.497,22** |
| **Cobertura** | **6,0%** |

**Por que tão baixo:** só **708 das 11.687 NFs** (6,06%) estão vinculadas ao pedido
de origem. O elo que falta é NF↔pedido, não o item — 99,94% da receita já tem item.
A fila de vinculação roda por janela e ainda não cobriu agosto. (Com a base NF, a
cobertura agora compara faturado com faturado — antes o numerador era o valor do
pedido, levemente inflado.)

**Como dizer isso:** *"a margem fiscal de −5,5% é real, mas medida sobre 6% da
receita do mês — uma amostra pesada em Shopee e tíquete baixo, não o resultado do
mês."* O selo "parcial" no card e a nota de rodapé dizem exatamente isso — é um
contrato de honestidade deliberado do sistema, não um bug de exibição.

Referência histórica: em junho a cobertura chegou a 61,5% da receita.

---

## 6. Ressalvas

1. **O ICMS de 1,3%/6%/14% é a carga efetiva do regime especial, não a da NF.** A
   NF destaca a alíquota nominal (a 533740 mostra 12% interestadual); o benefício
   de MG (crédito presumido do RET) acontece na apuração e reduz a carga ao efetivo.
   O motor mede o efetivo — **confirmar com o contador que o crédito presumido
   cobre todas as vendas.**
2. **PIS/COFINS está no débito bruto, sem os créditos da apuração.** Decisão do
   negócio (custo é gestão interna): o número exibido é conservador. Dois refinos
   possíveis com o contador: os créditos das entradas e a **exclusão do ICMS
   destacado da base (Tema 69/STF)** — na NF 533740, o débito cairia de R$ 4,11
   para R$ 3,62.
3. **Sem substituição tributária e sem benefício por NCM**: a regra é uniforme por
   UF + origem, não olha o NCM nem o regime específico do produto.
4. **A comissão de Amazon, Shein e Kwai é tabelada, não medida.** Só a Shopee tem
   conferência contra dado real (ver abaixo). Amazon usa 15% (topo da faixa de
   casa/cozinha, por conservadorismo) e Kwai usa 20% + R$ 4 sem tabela pública
   oficial — vale confirmar no painel de cada seller. Juntos são ~0,9% da receita.
5. **A comissão não separa anúncio Clássico de Premium no ML.** Está tudo como
   Clássico (13%), confirmado pelo negócio.
6. **Reforma tributária já aparece na NF** (IBS 0,1% + CBS 0,9% em 2026): valor de
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
| Base NF + DIFAL por dentro + custo fora dos impostos | `supabase/migrations/20260804190000_fiscal_margin_nf_base_no_cost_in_taxes.sql` |
| Alíquotas por UF (dado editável) | tabela `oraculo_state_tax_params` |
| Mesmas regras em JS, com testes | `packages/domain/fiscal.js` + `fiscal.test.js` |
| Documentação das regras portadas | `docs/fiscal-financeiro-port.md` |
| Job horário que regrava o snapshot | `supabase/migrations/20260710190000_hourly_fiscal_snapshots.sql` |
| Leitura dos snapshots pelo site | `apps/web/lib/fiscal-snapshots.ts` |
| Cards e donut do dashboard | `apps/web/app/page.tsx` |
| Painel por SKU | `apps/web/app/skus/page.tsx` |
| Calculadora de precificação | `apps/web/app/calculadora/calculator.tsx` |

**Nota técnica:** a antiga divergência SQL × JS no DIFAL intraestadual foi
resolvida em 04/08/2026 — os dois agora zeram MG→MG e usam a base por dentro
(`calcDifalPorDentro`, testada com os números da NF 533740). As funções do porte
original do Financeiro permanecem no `fiscal.js` como especificação histórica.
