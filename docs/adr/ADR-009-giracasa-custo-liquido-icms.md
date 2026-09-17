# ADR-009: Custo da Giracasa é líquido de ICMS e PIS/COFINS

## Status

Accepted — 17/09/2026. Substitui, só para a Giracasa, a precedência de custo do
ADR-005 e as alíquotas internas do ADR-004.

## Contexto

A conferência dos 40 dias (30/07–07/09) mostrou que o lucro da Giracasa dependia
inteiramente de uma premissa nunca validada: o motor `gira-casa-v1` usava custo
bruto e abatia o crédito de PIS/COFINS dentro do imposto da venda. Com crédito, o
resultado era +R$ 41 mil; sem crédito, −R$ 6 mil.

O contador (Eduardo Faleiros) definiu em 15 e 17/09/2026:

> O custo seria líquido, ou seja, custo menos ICMS menos PIS/COFINS.
> Os impostos seriam conforme tabela. PIS/COFINS 9,25%.

A tabela enviada traz a matriz origem × destino. As alíquotas interestaduais
coincidem com as que o motor já usava. A diagonal (alíquotas internas) difere da
tabela vigente em 2026 que o Oráculo aplica em Uberlândia: BA 18% contra 20,5%,
MA 18% contra 22%, RJ 20% contra 22%.

O ICMS da compra deixou de ser suposição: as notas de entrada foram carregadas
(dez/2025 a set/2026) com o filtro `tipo=E` da API v3 e trazem `valorIcms` e
`baseIcms` no cabeçalho. Medição: nacional 12% (Entrerios/SC), importado 4%
(Jacartta/MG), compras dentro de SP 18%.

## Decisão

- Custo da Giracasa = `custo × (1 − ICMS da compra − 9,25%)`, os dois créditos
  sobre o custo cheio, conforme resposta do contador.
- O ICMS da compra vem da **última nota de entrada do produto** (CFOP x101, x102,
  x401, x403). Kit soma o custo líquido de cada componente. Produto sem compra
  registrada usa 12% (nacional) ou 4% (importado).
- Divergência de nota entra como **exceção por nota**, em
  `giracasa.oraculo_purchase_icms_overrides`, não como regra genérica. Primeira
  exceção: NF 000001 da Jacartta (24/07/2026, R$ 179.726,40), emitida com ICMS
  zero por erro pontual, registrada como 4%.
- PIS/COFINS na venda passa a ser o débito cheio de 9,25%: o crédito já está no
  custo e não pode ser reconhecido duas vezes.
- DIFAL continua pela diferença simples de alíquotas (ADR-004), mas com as
  **alíquotas internas da tabela do contador**, isoladas em
  `GIRA_CASA_INTERNAL_ICMS_RATES`. Uberlândia segue com `INTERNAL_ICMS_RATES`.
- A transferência importada com fator 0,8425 é descontinuada na Giracasa: foi
  substituída pelo ICMS medido. Custo líquido explícito e créditos medidos por
  SKU mantêm precedência sobre a fórmula.
- Versão do motor passa a `gira-casa-v2`, incluindo o padrão das regras por SKU e
  dos snapshots.

## Consequências

Na janela conferida, o resultado sai de R$ 41.031 (3,54%) para R$ 85.568
(7,37%), com ROI de 20,11%. O ICMS de saída não muda; o PIS/COFINS da venda sobe
para o débito cheio e o custo cai pelos dois créditos. O ICMS de compra vem de
nota fiscal para 148 produtos; os demais usam a média por origem.

Uberlândia não é tocada: nenhuma função, view ou tabela de `public` muda, e a
tabela de alíquotas internas dela continua a de 2026.

Pendências que este ADR não resolve: as 471 NFs de pedidos cancelados, a
conferência contra a apuração de agosto, as tarifas de TikTok e Mercado Livre e
o cadastro dos SKUs sem custo.
