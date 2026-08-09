# Auditoria fiscal Jacartta — 2026-08-09

Auditoria do bloco `Margem e ROI fiscais`, solicitada após o painel mostrar
lucro e margem negativos. Escopo: cadastro da empresa, regras dos marketplaces,
NF real, custo Olist, comissão Shopee, cobertura e implementação SQL.

## Identificação conferida

- CNPJ: `42.033.601/0001-40`.
- Razão social: `JACARTTA COMERCIO ATACADISTA E VAREJO ELETRONICO LTDA.`
- Nome fantasia: `Espaço de Bicho`.
- Município/UF: Uberlândia/MG.
- Situação cadastral: ativa; abertura em 21/05/2021.
- Inscrição estadual pública encontrada: `004.052.627.00-39`.
- Regime tributário observado nas NFs hidratadas da Olist: `3` (regime
  normal), compatível com Lucro Real, mas não prova sozinho o RET.

O comprovante de CNPJ não contém o número nem a íntegra de regime especial. A
consulta pública não localizou um RET nominal da Jacartta. A confirmação
individual exige o termo/alterações no SIARE ou documento fornecido pelo
contador. O motor mantém, portanto, a carga de ICMS/OP interestadual de 1,3%
como regra do perfil Jacartta, mas documentada como dependente do RET vigente.

## Evidência tributária

- As planilhas fiscais de Shopee, Amazon e Mercado Livre usam PIS 1,65% e
  COFINS 7,60% nas vendas (CST 01): débito bruto de 9,25%.
- As planilhas distinguem mercadoria nacional e importada: alíquota nominal
  interestadual de 7%/12% para nacional e 4% para importada. O motor usa essas
  alíquotas nominais no DIFAL; não usa 1,3% para diminuir o DIFAL.
- O ICMS/OP de 1,3% é carga líquida depois do crédito presumido do RET e fica
  separado do ICMS nominal da NF. Decisões publicadas pela SEF/MG confirmam a
  existência dessa carga para e-commerce mineiro mediante solicitação.
- O DIFAL continua devido ao destino nas vendas interestaduais a consumidor
  final não contribuinte e é calculado por dentro. Em MG→MG fica zerado.
- FCP permanece fora do motor por decisão do negócio registrada em 04/08. As
  planilhas mostram FCP apenas em destinos/produtos pontuais; a NF hidratada de
  agosto trouxe R$ 36,12 de FCP destino, concentrados em RJ e SE. Não há base
  para aplicar FCP genérico a todo o portfólio.
- CBS/IBS não foram adicionados ao custo de 2026: os campos já aparecem nas NFs,
  mas 2026 é ano-teste e o contribuinte aderente às obrigações acessórias está
  dispensado do recolhimento.
- O custo médio Olist pode estar bruto ou líquido de recuperáveis, conforme as
  opções usadas na formação de preços. Por isso o motor não inventa crédito de
  PIS/COFINS por SKU; mostra o débito bruto conservador e deixa o crédito real
  para a apuração contábil.

Fontes públicas usadas:

- SEF/MG, Acórdão 25.299/25/3ª: https://www.fazenda.mg.gov.br/secretaria/conselho_contribuintes/acordaos/2025/3/25299253.pdf
- SEF/MG, Resolução 5.793/2024: https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/resolucoes/2024/rr5793_2024.html
- LC 190/2022: https://planalto.gov.br/ccivil_03/leis/lcp/lcp190.htm
- Receita Federal, PIS/Cofins não cumulativos: https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/restituicao-ressarcimento-reembolso-e-compensacao/creditos/piscofins
- Receita Federal, orientações da reforma para 2026: https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026
- Olist, formação de preços: https://ajuda.olist.com/pt_BR/precificacao/formacao-de-precos

## Diagnóstico do negativo

Antes da correção, agosto tinha R$ 1.984.374,42 de receita com custo e margem
de -4,93%. A composição já ultrapassava a receita:

- custo: R$ 1.009.588,09 (50,88%);
- ICMS + PIS/COFINS + DIFAL: R$ 530.586,17 (26,74%);
- marketplace: R$ 542.087,96 (27,32%).

O principal problema econômico é a Shopee. Após ampliar a cobertura, as quatro
lojas continuam negativas entre -3,96% e -9,95%; TikTok, Mercado Livre e Amazon
ficam positivos no mesmo motor. A taxa modelada da Shopee (~28,8% no mix) foi
comparada ao escrow real disponível de Jacartta/Espaço de Bicho (~28,0%-28,7%)
e está na mesma ordem de grandeza.

## Defeitos corrigidos

Migration: `20260809120000_fiscal_margin_hybrid_item_source.sql`.

1. O motor voltava à tabela bruta de NFs depois de começar pelos links. Uma NF
   status 3, de R$ 78,90, entrou na margem. Agora a fonte obrigatória é
   `oraculo_fiscal_invoices_valid`.
2. A margem dependia exclusivamente de `olist_order_items`, embora milhares de
   NFs já tivessem `olist_invoice_items`. A nova precedência é item do pedido e,
   na ausência dele, item fiscal da NF.
3. O fallback rateia sempre o `vNF`; preço cheio do item fiscal é apenas peso.
   NF de valor zero permanece zero e não reaparece pelo valor do pedido.
4. Em kit aberto em componentes, a taxa fixa de marketplace incide uma vez por
   NF no fallback e é rateada entre componentes. Ela não multiplica pelo número
   de componentes.

Validação de custo: em 28.113 NFs com as duas fontes disponíveis, a razão
mediana entre custo por item fiscal e por item do pedido foi 1,0000; 28.087
ficaram dentro de 2%, com diferença agregada inferior a 0,1%.

## Produção depois da correção

Período: 01–09/08/2026, NFs do mês disponíveis em 09/08.

| Métrica | Antes | Depois |
|---|---:|---:|
| Receita oficial | R$ 2.489.490,99 | R$ 2.489.490,99 |
| Cobertura de itens | 81,45% | 95,95% |
| Cobertura de custo | 79,71% | 93,43% |
| Receita com custo | R$ 1.984.374,42 | R$ 2.325.835,70 |
| Custo | R$ 1.009.588,09 | R$ 1.183.487,47 |
| Tributos | R$ 530.586,17 | R$ 623.466,46 |
| Marketplace | R$ 542.087,96 | R$ 633.197,25 |
| Lucro | -R$ 97.887,80 | -R$ 114.315,48 |
| Margem | -4,93% | -4,92% |
| ROI | -9,70% | -9,66% |

O snapshot de produção foi regravado. A cobertura maior aumentou os valores
absolutos, mas confirmou a mesma margem percentual: o sinal negativo é real
dentro das premissas atuais, não um artefato do card.

## Pendência que exige documento

Solicitar ao contador a íntegra do RET vigente da IE `004.052.627.00-39`, com
número, versões/aditivos, vigência, alíquotas por operação, mercadorias
excluídas, FCP/ST e condições/metas. Sem isso, não é tecnicamente seguro marcar
as 54 linhas de `/parametros` como validadas nem reduzir o ICMS por suposição.

