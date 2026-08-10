# Estado do projeto — 2026-08-09

Supersede `docs/project-status-2026-08-07.md`. O estado anterior continua
válido; esta atualização registra a auditoria e a correção da margem fiscal.

## Margem fiscal auditada

A auditoria completa do CNPJ, planilhas fiscais por marketplace, NFs Olist,
custos, DIFAL, RET e comissão está em
`docs/fiscal-audit-jacartta-2026-08-09.md`.

Produção agora usa fonte híbrida por NF: item do pedido quando existe e item
fiscal como fallback. A função parte exclusivamente de NFs válidas, preserva o
`vNF` como receita e não multiplica a taxa fixa de marketplace pelos componentes
de um kit. Migration `20260809120000` aplicada e snapshot regravado.

Agosto em 09/08: receita oficial R$ 2.489.490,99; cobertura de custo 93,43%;
lucro fiscal parcial -R$ 114.315,48; margem -4,92%; ROI -9,66%. A expansão da
cobertura confirmou a margem anterior (-4,93%), portanto o negativo é econômico
dentro das premissas cadastradas, concentrado nas quatro operações Shopee.

Atualização visual em 10/08: quando o lucro fiscal está negativo, o dashboard
exibe `Por que está negativo?` com a decomposição dinâmica de custo do produto,
impostos e marketplace como percentual da receita coberta, além do valor que
falta a cada R$ 100 faturados. A explicação respeita o filtro de período ativo;
no mês corrente, inclui a concentração de receita na Shopee e os cinco SKUs
não pertencentes a tapetes com maior prejuízo obtidos do snapshot fiscal, sem
cálculo pesado no render. Cada item abre a conta unitária entre venda, custo,
tributos e marketplace.

## Limite de confirmação do RET

O CNPJ confirma a empresa e as NFs confirmam CRT/regime normal, mas nenhum dos
dois publica a íntegra do RET individual. A carga interestadual de ICMS/OP de
1,3% é compatível com o tratamento de e-commerce mineiro publicado pela SEF/MG,
mas as linhas de `/parametros` permanecem pendentes até receber a íntegra do RET
vigente da IE `004.052.627.00-39`.
