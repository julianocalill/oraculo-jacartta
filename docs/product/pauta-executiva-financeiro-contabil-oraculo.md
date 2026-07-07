# Pauta executiva - Financeiro e contabil - Oraculo

Data: `2026-06-25`

## Objetivo da reuniao

Alinhar com o financeiro/contabil as regras oficiais que o Oraculo precisa para calcular:

- margem;
- lucro;
- ROI;
- impostos por UF e operacao;
- alertas financeiros por produto e canal.

## Contexto rapido

O Oraculo ja consolidou a camada fiscal oficial da Olist.

Premissa oficial aprovada:

- venda oficial = NF faturada de saida;
- receita oficial = valor total da NF emitida/autorizada;
- data oficial = data de emissao da NF.

Validacao de `2026-06-01` a `2026-06-19`:

- Olist: `71.197` NFs / `R$ 5.243.629,96`;
- Oraculo: `71.198` NFs / `R$ 5.243.715,76`.

Conclusao: faturamento fiscal esta reconciliado. O proximo passo e definir corretamente custos, impostos e regras de margem/ROI.

## O que precisamos decidir hoje

1. Qual margem oficial a diretoria quer acompanhar?
2. Qual e a fonte oficial do custo do SKU?
3. Quais impostos entram no calculo?
4. A regra fiscal sera por UF, por operacao ou por ambos?
5. Quais taxas por canal precisam entrar?
6. Como tratar frete subsidiado e embalagem?
7. Qual sera a formula oficial de ROI?
8. Quais faixas devem gerar alerta?

## Dados que precisamos receber

### Por SKU

- custo unitario oficial;
- regra de atualizacao do custo;
- excecoes relevantes.

### Por canal

- comissao;
- taxa de pagamento;
- tarifa fixa;
- frete subsidiado;
- embalagem;
- margem meta;
- margem minima.

### Por UF e operacao

- ICMS interno do destino;
- ICMS interestadual;
- FCP;
- DIFAL calculado;
- taxa efetiva calculada;
- vigencia da regra;
- observacoes ou excecoes.

## Perguntas objetivas

1. A margem oficial sera bruta, de contribuicao ou liquida operacional?
2. O custo do produto entra com ou sem credito de imposto?
3. PIS/COFINS entra no calculo?
4. ST entra no calculo quando aplicavel?
5. Frete subsidiado entra por item ou por pedido?
6. Embalagem entra como custo fixo por pedido ou custo medio por item?
7. O ROI sera calculado sobre qual base?
8. Qual e a meta minima aceitavel de margem?
9. Qual e a meta minima aceitavel de ROI?
10. Quem sera o responsavel por validar e manter esses parametros?

## Decisoes esperadas na saida

- definicao oficial de margem;
- definicao oficial de ROI;
- fonte oficial de custo do SKU;
- regra fiscal por UF/operacao;
- regra de taxas por canal;
- regra de frete e embalagem;
- faixas de alerta;
- nome do responsavel por manutencao.

## Como isso vira sistema

Depois da reuniao:

1. cadastrar os parametros no frontend do Oraculo;
2. aplicar as regras nas views de margem e ROI;
3. validar os calculos com alguns SKUs reais;
4. liberar leitura oficial por produto e canal;
5. ativar alertas financeiros.

## Checklist da reuniao

- [ ] Definicao de margem aprovada
- [ ] Definicao de ROI aprovada
- [ ] Fonte de custo definida
- [ ] Regras de impostos alinhadas
- [ ] Taxas por canal alinhadas
- [ ] Regra de frete alinhada
- [ ] Regra de embalagem alinhada
- [ ] Faixas de alerta aprovadas
- [ ] Responsavel pelos parametros definido
