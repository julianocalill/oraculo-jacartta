# ADR-005 — Custo do produto líquido de créditos recuperáveis

- Status: aceito
- Data: 2026-08-14

## Contexto

Até aqui o custo do produto entrava bruto, exatamente como está no cadastro da
Olist (`preco_custo_medio`, com fallback para `preco_custo`). Isso superestima o
desembolso real: parte do que se paga na entrada volta como crédito na apuração e
nunca fica na empresa.

A decisão de 04/08/2026 tinha tirado o crédito de PIS/COFINS do cálculo do imposto
com o argumento de que "custo é gestão interna e não entra em imposto". O efeito
colateral foi que o crédito sumiu das duas pontas: não abatia o imposto e não
abatia o custo. O resultado exibido ficou conservador demais.

## Decisão

O custo do produto passa a ser **líquido dos créditos recuperáveis**, pela origem
da mercadoria:

| Origem | Crédito | Fator |
|---|---:|---:|
| Nacional | 9,25% (PIS/COFINS não cumulativo) | × 0,9075 |
| Importado | 11,75% (PIS/COFINS-Importação: 2,1% + 9,65%) | × 0,8825 |

A regra vive em **uma única função** — `oraculo_net_cost(bruto, origem)`,
com `oraculo_net_cost_rate(origem)` ao lado — usada pelas três views que resolvem
custo, para que não possam divergir:

1. `oraculo_product_effective_cost` → motor fiscal (margem/ROI fiscais, painel de `/skus`);
2. `oraculo_sku_unit_cost` → Shopee, Mercado Livre e devoluções;
3. `oraculo_sku_margin_30d` → margem/ROI operacionais de `/skus`.

Migration: `supabase/migrations/20260814150000_custo_liquido_creditos.sql`.
Espelho em JS: `calcNetCostByOrigin` em `packages/domain/fiscal.js`.

Detalhes que a decisão fixa:

- **Kit desconta por componente**, com a origem de cada um — um kit pode misturar
  nacional e importado.
- **O override manual de `/parametros` é tratado como custo BRUTO.** Quem digita
  informa o que pagou; o motor desconta o crédito. Assim a regra é a mesma venha o
  número de onde vier. O campo passou a se chamar "Custo unitário bruto".
- **Importado usa só os 11,75%.** O porte do app Financeiro previa 15,75% (4% de
  ICMS + 11,75%) para importado por transferência; o ICMS ficou de fora porque a
  base não tem a flag que identifica a entrada por transferência.

## Não há dupla contagem

O crédito de PIS/COFINS aparece **uma vez só**, do lado do custo. O imposto
continua sendo o débito bruto que a NF destaca (9,25% sobre o valor da nota, sem
crédito). Em lucro, descontar 9,25% do custo ou abater 9,25% do custo no imposto
dá exatamente o mesmo número — o que muda é a leitura: o imposto exibido continua
conferindo com a NF, e o custo passa a refletir o desembolso que fica.

## Consequências

**Impacto medido em produção** (01–14/08/2026, cobertura 96,5%):

| | Antes | Depois |
|---|---:|---:|
| Custo do produto | R$ 1.996.913,36 | R$ 1.777.481,69 |
| Lucro fiscal | −R$ 49.567,99 | **+R$ 169.862,34** |
| Margem fiscal | −1,30% | **+4,44%** |
| ROI fiscal | −2,48% | **+9,56%** |

**A operação coberta fecha positiva pela primeira vez.** Somando com a mudança do
DIFAL no mesmo dia (ADR-004), a margem do período saiu de −5,16% para +4,44% sem
que uma única venda mudasse — as duas premissas juntas valem 9,6 pontos de margem.
Isso pede cautela na leitura: o resultado melhorou porque a régua mudou.

**A trava de sanidade passou a comparar o custo líquido** com o preço de venda
(descarta a linha quando custo > 3× preço). Como o líquido é menor, algumas linhas
que ficavam de fora entraram — daí a receita coberta subir de R$ 3.824.978,14 para
R$ 3.824.984,51 e os impostos R$ 1,73.

**Pendências:**

1. **Confirmar com o contador que o crédito é integral.** Compra de fornecedor do
   Simples Nacional, mercadoria com PIS/COFINS monofásico ou ST não geram crédito
   de 9,25% cheio. A regra atual aplica a alíquota a todo o portfólio, uniforme.
2. **A origem vem do cadastro da Olist** (`payload->>'origem' = '1'`). Se o cadastro
   estiver errado, o crédito sai errado junto — e a mesma flag já governa ICMS e DIFAL.
3. **Frete de entrada, embalagem e armazenagem continuam fora do custo.** O número
   é o custo de aquisição da mercadoria, não o custo posto no cliente.

## Referências

- Regra anterior e histórico do porte: `docs/fiscal-financeiro-port.md`.
- Mudança irmã do mesmo dia: `docs/adr/ADR-004-difal-diferenca-aliquotas.md`.
- Receita Federal, créditos de PIS/Cofins não cumulativos:
  https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/restituicao-ressarcimento-reembolso-e-compensacao/creditos/piscofins
