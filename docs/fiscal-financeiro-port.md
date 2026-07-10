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
3. **bruto − créditos recuperáveis explícitos** (`max(0, bruto − créditos)`);
4. **bruto puro** (fallback).

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

## PIS/COFINS 9,25% (líquido de crédito)

```
débito  = base × 9,25%
crédito = custo × 9,25%   (habilitado por padrão)
pis_cofins = max(0, débito − crédito)
```

## DIFAL (separado do ICMS)

```
difal = base × max(0, icms_interno_destino − interestadual) / 100
```

- **Alíquota interna do destino** (`INTERNAL_ICMS_RATES`, 27 UFs): AC19 AL20 AP18
  AM20 BA20,5 CE20 DF20 ES17 GO19 MA22 MT17 MS17 MG18 PA19 PB20 PR19,5 PE20,5 PI21
  RJ22 RN20 RS17 RO19,5 RR20 SC17 SP18 SE19 TO20.
- **Alíquota interestadual**: intraestadual 0; importado 4; nacional 12 se origem e
  destino ambos em {MG, PR, RJ, RS, SC, SP}, senão 7. Origem padrão: MG (Jacarta).

## Taxa de marketplace (Shopee, por faixa)

| Faixa de venda | % | Fixo |
|---|---|---|
| ≤ R$ 79,99 | 20% | R$ 4 |
| R$ 80–99,99 | 14% | R$ 16 |
| R$ 100–199,99 | 14% | R$ 20 |
| R$ 200–499,99 | 14% | R$ 26 |
| > R$ 500 | 14% | R$ 28 |

`taxa = venda × %/100 + fixo`. **No Oráculo (Olist) esta taxa é 0** — não há faixa
de marketplace cadastrada; por isso a margem exibida é fiscal-parcial.

## Lucro, margem, ROI

```
lucro  = receita − taxa_marketplace − custo − impostos(ICMS+PIS/COFINS+DIFAL) − despesas
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
