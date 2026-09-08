# Contrato financeiro da Giracasa

Este documento define o comportamento do motor `gira-casa-v1` no Oráculo. A
referência original é o perfil **Gira Casa** do projeto Financeiro; o contrato
abaixo registra também as adaptações necessárias para o faturamento canônico do
Oráculo.

## Receita e identidade da venda

- Receita oficial vem somente de NF de saída válida: status 6 ou 7, sem NF de
  entrada e sem origem `devolucao`.
- A base é o valor total da NF rateado entre os itens. NF válida com valor zero
  permanece com receita zero.
- Pedido da Olist e pedido do marketplace servem para vínculo, canal, quantidade
  e tarifa. Eles não criam uma segunda receita.
- O Financeiro local usa o valor bruto como fallback quando falta valor de NF.
  O Oráculo deliberadamente não usa esse fallback: a linha fica pendente até a
  evidência fiscal existir.

## ICMS e DIFAL

Origem da operação: **São Paulo**.

| Origem da mercadoria | Destino SP | MG, PR, RJ, RS e SC | Demais UFs |
| --- | ---: | ---: | ---: |
| Nacional | 18% | 12% | 7% |
| Importada | 18% | 4% | 4% |

O DIFAL é calculado somente em operação interestadual:

```text
DIFAL = base da NF × max(alíquota interna do destino − alíquota interestadual, 0)
```

SP→SP produz DIFAL zero para produto nacional ou importado. Uma regra por UF,
origem e vigência pode substituir a matriz depois de validação contábil.

## Custo

A precedência reproduzida do Financeiro é:

1. custo líquido explícito;
2. custo bruto menos créditos recuperáveis medidos;
3. transferência importada comprovada: custo bruto × `0,8425`;
4. custo bruto sem redução.

O mesmo SKU em Uberlândia e na Giracasa representa dois cadastros operacionais.
Custos, origem, composição do kit e exceções não são copiados entre empresas.
Kit só recebe resultado quando todos os componentes necessários possuem custo.

## PIS/COFINS

A alíquota padrão do Financeiro é 9,25%:

```text
débito = base da NF × 9,25%
crédito = custo resolvido × 9,25%, quando habilitado
PIS/COFINS = max(débito − crédito, 0)
```

O Financeiro habilita o crédito por padrão. Na Giracasa, cada exceção por SKU e
vigência grava `pis_cofins_credit_enabled`. Quando o custo líquido explícito ou
os créditos recuperáveis medidos já incorporarem o mesmo PIS/COFINS, o campo
deve ser desabilitado para não reconhecer o benefício duas vezes. Essa decisão
faz parte da conferência da amostra de um dia.

## Comissão, pendências e versão

- Comissão é escolhida pelo canal identificado na NF e pelas faixas próprias da
  operação.
- Custo, UF, origem fiscal ou tarifa insuficiente deixam lucro, margem e ROI
  nulos. Zero não substitui uma informação ausente.
- Snapshots registram `operation_id` e `financial_rule_version`.
- Mudança de regra cria nova versão e nova vigência; não reescreve silenciosamente
  o resultado histórico.

## Casos mínimos de homologação

1. Produto nacional SP→SP, sem DIFAL.
2. Produto importado SP→SP, ICMS 18% e sem DIFAL.
3. Produto nacional de SP para MG e para uma UF fora do Sul/Sudeste.
4. Produto importado interestadual com alíquota de 4%.
5. Custo líquido explícito, crédito medido e transferência importada.
6. Kit completo e kit com componente sem custo.
7. Crédito de PIS/COFINS habilitado e desabilitado.
8. NF ausente, UF ausente, tarifa ausente e custo ausente, todos como pendência.
