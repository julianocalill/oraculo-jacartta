# Regras fiscais portadas do app Financeiro

Referência das fórmulas fiscais do app **Financeiro** (perfil Jacarta, Lucro Real
com RET) portadas para o Oráculo. A fonte executável é `packages/domain/fiscal.js`
(coberta por `packages/domain/fiscal.test.js`); a aplicação em produção é a camada
SQL `supabase/migrations/20260710093000_create_fiscal_margin.sql`. Ao mudar uma
regra, atualize os três: este doc, o domínio + testes, e o SQL.

## Regime

Lucro Real com RET, materializado por: (1) crédito de PIS/COFINS na entrada
habilitado (não-cumulativo); (2) PIS/COFINS base 9,25%; (3) alíquotas de ICMS
reduzidas do perfil Jacarta. Não há componente de RET calculado à parte.

## Custo do produto

Precedência (`calcNetCost`):

1. **custo líquido explícito**, se informado;
2. **importado por transferência** → `custo = valor_nf × (1 − 0,1575)` = `× 0,8425`
   (0,04 ICMS + 0,1175 PIS/COFINS). Ex.: NF R$ 393.300 → R$ 331.355,25.
   **Não se aplica ao Oráculo** — ver abaixo.
3. **bruto − créditos recuperáveis explícitos** (`max(0, bruto − créditos)`);
4. **bruto puro** (fallback).

> **Decisão do negócio (04/08/2026):** mercadoria que entra por transferência e vai
> para o estoque geral **tem o mesmo custo do produto normal** — se custa R$ 1 e
> volta ao estoque, continua custando R$ 1. A regra `×0,8425` do app Financeiro
> **não é aplicada** e isso deixa de ser uma pendência. O crédito de PIS/COFINS
> sobre o custo, aliás, já está no motor (é o crédito de 9,25% do cálculo).

No Oráculo, o custo unitário vem de `oraculo_product_effective_cost`:
- produto simples: `preco_custo_medio > 0 ? preco_custo_medio : preco_custo`;
- **kit (tipo K): soma dos componentes** de `payload->'kit'`
  (`quantidade × custo_componente`); `cost_complete` indica se todos os componentes
  tinham custo.

Sanidade: custo indisponível quando `custo ≤ 0`, kit sem custo completo, ou custo
implausível (`> 3× o preço de venda real do item`, pois `olist_products.preco` é
placeholder para muitos SKUs). A regra `×0,8425` de importado por transferência
**não** é aplicada automaticamente por falta da flag de transferência na base atual.

## ICMS de saída (matriz Jacarta)

| Origem | MG | Demais UFs |
|---|---|---|
| Nacional | 6% | 1,3% |
| Importado | 14% | 1,3% |

Perfil Gira Casa (referência): nacional → SP 18%, Sul/Sudeste 12%, demais 7%;
importado → SP 18%, demais 4%.

Origem: `olist_products.payload->>'origem' = '1'` → importado, senão nacional.

`ICMS = base × alíquota / 100`, base = valor do item.

## Base fiscal: valor da NF, rateado por item (04/08/2026)

A base de todos os tributos e da comissão é o **valor faturado na NF**
(`olist_invoices.fiscal_amount` = `vNF`), não o valor do pedido. Medido em
01/08: 30% das NFs divergem do pedido (cupom do vendedor fica no pedido pelo
preço cheio; a NF sai pelo pago) e a receita estava inflada 6,95%.

O item da NF não serve de base direta — kit do pedido vira componentes na NF, e
o item da NF também carrega preço cheio (o desconto fica em `vDesc`, no total).
Por isso o `vNF` é **rateado** pelas linhas do pedido proporcionalmente ao valor
de cada item. O rateio também conserta pedido com duas NFs (antes contava a
receita em dobro). Sem `vNF`, a linha cai no valor do pedido.

## PIS/COFINS 9,25% — débito bruto (sem crédito de custo)

```
pis_cofins = base_NF × 9,25%
```

**Decisão de 04/08/2026:** o custo do produto é gestão interna e **não entra em
cálculo de imposto**. O débito é bruto, como a NF destaca (CST 01; na NF real
533740: 44,51 × 1,65% + 44,51 × 7,60% = 4,11). O crédito das entradas continua
existindo na apuração da empresa — só não é simulado por linha. Consequência:
o PIS/COFINS exibido é conservador (maior que o efetivamente recolhido).

Regra original do Financeiro (não usada mais no motor): débito − crédito sobre
o custo, piso zero — permanece em `calcPisCofins` com `creditEnabled: true`.

## Alíquotas configuráveis na tela (`/parametros` → Imposto por UF)

Desde a migration `20260804160000`, as alíquotas de ICMS **saem do código quando há
parâmetro validado**. `oraculo_fiscal_margin_lines` consulta
`oraculo_state_tax_params` por linha, casando **UF + origem da mercadoria + data de
emissão da NF**, e só usa a linha quando `params_configured = true` e a vigência
cobre a data. Sem linha validada, valem as regras fixas descritas abaixo.

| Campo da tela | O que substitui |
|---|---|
| **ICMS de saída** (`outbound_icms_rate`) | a matriz Jacartta. Nulo/vazio = matriz |
| **ICMS interno destino** (`icms_rate`) | a tabela fixa das 27 UFs (só DIFAL) |
| **ICMS interestadual** (`interstate_icms_rate`) | a regra 4% / 12% / 7% (só DIFAL) |

O **FCP** (`fcp_rate`) chegou a ser ligado ao cálculo em `20260804160000` e foi
**desativado no mesmo dia** (`20260804180000`) por decisão do negócio: não se aplica
ao portfólio. A coluna continua no banco, zerada, fora do cálculo e fora da tela.

Precedência quando há mais de uma linha candidata: origem exata > `*`; fonte `olist`
> `*`; `valid_from` mais recente.

Duas colunas foram criadas para isso: `merchandise_origin` (entrou na PK — sem ela,
uma linha por UF aplicaria a alíquota do nacional também no importado) e
`outbound_icms_rate` (o ICMS de saída não tinha campo; `icms_rate` sempre foi a
alíquota **interna do destino**, usada só no DIFAL — são coisas diferentes).

As 27 UFs × 2 origens foram semeadas com **exatamente os valores que o motor já
aplicava**, como `Pendente`. Verificado: validar uma linha semeada produz números
idênticos aos da regra fixa. Validar é revisar e marcar, não digitar do zero.

## DIFAL — por dentro, só interestadual (04/08/2026)

```
base_destino = base_NF / (1 − interna_destino)
difal        = max(0, base_destino × interna_destino − base_NF × interestadual)
difal        = 0 quando a venda é dentro de MG (intraestadual)
```

Validado contra a NF real 533740 (MG→RJ, vNF 44,51): `vBCUFDest 57,06 =
44,51/0,78`; `vICMSUFDest 7,21 = 57,06×22% − 44,51×12%`. A fórmula antiga do
Financeiro (`base × (interna − interestadual)`, sem gross-up, cobrando
intraestadual) dava 4,45 — subestimava ~40% — e cobrava DIFAL indevido em
MG→MG. Espelho JS: `calcDifalPorDentro` (a `calcDifal` antiga permanece como
especificação do Financeiro).

Regra original do Financeiro (referência):

```
difal = base × max(0, icms_interno_destino − interestadual) / 100
```

- **Alíquota interna do destino** (`INTERNAL_ICMS_RATES`, 27 UFs): AC19 AL20 AP18
  AM20 BA20,5 CE20 DF20 ES17 GO19 MA22 MT17 MS17 MG18 PA19 PB20 PR19,5 PE20,5 PI21
  RJ22 RN20 RS17 RO19,5 RR20 SC17 SP18 SE19 TO20.
- **Alíquota interestadual**: intraestadual 0; importado 4; nacional 12 se origem e
  destino ambos em {MG, PR, RJ, RS, SC, SP}, senão 7. Origem padrão: MG (Jacarta).

## Comissão de marketplace (por faixa, por canal)

Decisão de negócio de **04/08/2026**: frete, ads, embalagem e despesa operacional
**não viram linhas próprias** — são tratados como já embutidos no desconto do
marketplace. A comissão usa as mesmas faixas da calculadora, agora também no motor
fiscal (migration `20260804140000`).

Fonte: tabela `oraculo_marketplace_fee_params` (dado, não código), casada com
`olist_invoices.fiscal_channel_label` via `ilike match_pattern` (menor
`match_priority` vence).

| Canal | Faixa (preço unitário) | % | Fixo/un. | Fonte da alíquota |
|---|---|---|---|---|
| **Shopee** | ≤ 79,99 / ≤ 99,99 / ≤ 199,99 / ≤ 499,99 / aberta | 20 / 14 / 14 / 14 / 14 | 4 / 16 / 20 / 26 / 28 | faixas originais da calculadora |
| **Mercado Livre** (Clássico) | ≤ 28,99 / ≤ 49,99 / ≤ 78,99 / aberta | 13 | 6,25 / 6,50 / 6,75 / 0 | Clássico confirmado pelo negócio 04/08/2026 |
| **TikTok Shop** | ≤ 78,99 / aberta | 6 | 4 / 0 | tabela vigente fev/2026 |
| **Amazon** | única | 15 | 0 | Seller Central BR: 8–15% por categoria, casa/cozinha 12–15% |
| **Shein** | única | 18 | 0 | política oficial SHEIN BR, pedidos a partir de 01/03/2026 |
| **Kwai Shop** | única | 20 | 4 | 20% + R$ 4/item (sem tabela pública oficial) |
| **Sem faixa** (venda sem canal, canal novo) | — | 0 | 0 | — |

Decisões nas três alíquotas novas (levantadas em 04/08/2026):
- **Amazon**: adotado o topo da faixa de casa/cozinha (15%) por conservadorismo. Sem
  taxa por item — ela só existe no plano Individual (R$ 2/item); a operação usa o
  Profissional (R$ 19/mês), que é custo fixo mensal, fora da linha de venda.
- **Shein**: 18% desde 01/03/2026 (era 16%). A comissão incide sobre o preço final
  com descontos/cupons de loja, e não é cobrada em devolução ou cancelamento.
- **Kwai**: o desconto de 14% dos primeiros 45 dias vale só para seller novo e não se
  aplica. O Kwai não desconta frete do vendedor. A plataforma não publica tabela
  detalhada — vale reconferir no painel do seller.

```
comissão = receita × rate/100 + fixed × quantidade
```

A faixa é escolhida pelo **preço unitário** (não pelo total da linha) e o fixo
multiplica a quantidade, porque nos três marketplaces o fixo é cobrado por unidade
vendida e os degraus do ML (28,99 / 49,99 / 78,99) são limites por unidade.

Canal sem faixa cadastrada **não inventa comissão**: fica em 0 com
`fee_missing = true`, e `oraculo_fiscal_margin_summary` reporta a receita nessa
situação em `revenue_without_fee_params` (o lucro dessas linhas fica superestimado).

**Validação contra dado real** (27/07/2026, escrow da Shopee via
`oraculo_shopee_take_rate_shop_daily_cache`): take rate efetivo de **27% a 34%** por
loja/dia. As faixas acima produzem **28,5%** sobre o mix real de 01/08 — dentro da
faixa observada, e conservador, já que o escrow não inclui ads nem subsídio de frete.

## Lucro, margem, ROI

```
lucro  = receita − custo − impostos(ICMS+PIS/COFINS+DIFAL) − comissão_marketplace
margem = lucro / receita        (null se receita ≤ 0)
roi    = lucro / custo          (null se custo ≤ 0)
```

Linha fica pendente (lucro/margem/ROI = null) quando falta custo ou a UF/origem não
resolve ICMS.

## Cobertura (contrato de honestidade)

A camada só produz margem para NFs válidas com pedido + item + custo confiável.
`oraculo_fiscal_margin_summary` expõe:
- `revenue_with_item` / `coverage_item_revenue_pct` — receita com item;
- `revenue_with_cost` / `coverage_cost_revenue_pct` — receita com custo confiável
  (a base real da margem).

Junho 01–19 (referência): cobertura de custo 61,5% da receita fiscal após expandir
kits; custo/receita ~37%; margem fiscal ~42%.
