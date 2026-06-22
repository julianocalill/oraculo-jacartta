# Reconciliação de Valores de NFs Olist

Data da auditoria: 2026-06-22T17:32:48.914Z
Período: 2026-06-01 a 2026-06-19

## Critério Manual da Olist

- NFs emitidas esperadas: 71.197
- Valor total esperado: R$ 5.243.629,96
- Tolerância exigida: diferença menor que 0,5% em quantidade e valor.

## Resultado Executivo

- Melhor combinação encontrada: status in (6,7) + total_amount
- Quantidade: 71.928 (delta 731, 1.027%)
- Valor: R$ 5.306.230,52 (delta R$ 62.600,56, 1.194%)
- Aceite atingido: não

Nenhuma combinação bateu com a tolerância exigida. Não criar views oficiais nem migrar dashboard/margem/ROI.

## Campos Monetários Encontrados

| Campo | Qtde | Soma | Mín | Máx |
| --- | --- | --- | --- | --- |
| raw_json.valorProdutos | 72.112 | R$ 9.068.617,34 | R$ 0,00 | R$ 314.389,91 |
| total_amount | 72.112 | R$ 7.064.326,82 | R$ 0,00 | R$ 324.607,57 |
| raw_json.valor | 72.112 | R$ 7.064.326,82 | R$ 0,00 | R$ 324.607,57 |
| raw_json.valorFrete | 72.112 | R$ 87.215,43 | R$ 0,00 | R$ 100,30 |
| raw_json.itens[0].valorTotal | 26 | R$ 3.452,19 | R$ 5,90 | R$ 1.312,33 |
| raw_json.pagamentosIntegrados[0].valor | 26 | R$ 2.947,78 | R$ 13,60 | R$ 1.309,00 |
| raw_json.valorFaturado | 26 | R$ 2.887,08 | R$ 5,90 | R$ 1.309,00 |
| raw_json.percentualICMSPartilhaDestino | 26 | R$ 2.500,00 | R$ 0,00 | R$ 100,00 |
| raw_json.itens[0].valorUnitario | 26 | R$ 2.266,81 | R$ 5,90 | R$ 1.312,33 |
| raw_json.baseIcms | 26 | R$ 1.578,08 | R$ 0,00 | R$ 184,80 |
| raw_json.parcelas[0].valor | 4 | R$ 1.551,26 | R$ 35,70 | R$ 1.309,00 |
| raw_json.valorDesconto | 26 | R$ 587,35 | R$ 0,00 | R$ 111,60 |
| raw_json.valorIcms | 26 | R$ 130,68 | R$ 0,00 | R$ 17,08 |
| raw_json.valorOutras | 26 | R$ 0,04 | R$ 0,00 | R$ 0,02 |
| raw_json.valorIpi | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.baseIcmsSt | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorIssqn | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorIcmsSt | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorSeguro | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorServicos | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorTotalCBS | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorTotalIBSUF | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorIPIDevolvido | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorTotalBCIBSCBS | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorBaseDiferimento | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorNotaComImpostos | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |
| raw_json.valorTotalICMSFCPDestino | 26 | R$ 0,00 | R$ 0,00 | R$ 0,00 |

## Melhores Combinações Status + Campo de Valor

| Cenário | Campo | NFs | Soma | Delta Qtde | Delta Qtde % | Delta Valor | Delta Valor % |
| --- | --- | --- | --- | --- | --- | --- | --- |
| status in (6,7) | total_amount | 71.928 | R$ 5.306.230,52 | 731 | 1.027% | R$ 62.600,56 | 1.194% |
| status in (6,7) | raw_json.valor | 71.928 | R$ 5.306.230,52 | 731 | 1.027% | R$ 62.600,56 | 1.194% |
| status <> 8 | total_amount | 72.023 | R$ 5.314.152,74 | 826 | 1.160% | R$ 70.522,78 | 1.345% |
| status <> 8 | raw_json.valor | 72.023 | R$ 5.314.152,74 | 826 | 1.160% | R$ 70.522,78 | 1.345% |
| status in (1,3,6,7) | total_amount | 72.023 | R$ 5.314.152,74 | 826 | 1.160% | R$ 70.522,78 | 1.345% |
| status in (1,3,6,7) | raw_json.valor | 72.023 | R$ 5.314.152,74 | 826 | 1.160% | R$ 70.522,78 | 1.345% |
| status = 6 | total_amount | 71.908 | R$ 5.014.631,93 | 711 | 0.999% | -R$ 228.998,03 | 4.367% |
| status = 6 | raw_json.valor | 71.908 | R$ 5.014.631,93 | 711 | 0.999% | -R$ 228.998,03 | 4.367% |
| status = 6 com pedido | total_amount | 71.188 | R$ 4.952.691,83 | -9 | 0.013% | -R$ 290.938,13 | 5.548% |
| status = 6 com pedido | raw_json.valor | 71.188 | R$ 4.952.691,83 | -9 | 0.013% | -R$ 290.938,13 | 5.548% |
| status = 6 com pedido | raw_json.valorProdutos | 71.188 | R$ 6.946.172,05 | -9 | 0.013% | R$ 1.702.542,09 | 32.469% |
| status = 6 | raw_json.valorProdutos | 71.908 | R$ 7.023.461,57 | 711 | 0.999% | R$ 1.779.831,61 | 33.943% |
| status in (6,7) | raw_json.valorProdutos | 71.928 | R$ 7.315.519,38 | 731 | 1.027% | R$ 2.071.889,42 | 39.513% |
| status <> 8 | raw_json.valorProdutos | 72.023 | R$ 7.324.306,09 | 826 | 1.160% | R$ 2.080.676,13 | 39.680% |
| status in (1,3,6,7) | raw_json.valorProdutos | 72.023 | R$ 7.324.306,09 | 826 | 1.160% | R$ 2.080.676,13 | 39.680% |
| status = 6 com pedido | raw_json.valorFrete | 71.188 | R$ 86.365,66 | -9 | 0.013% | -R$ 5.157.264,30 | 98.353% |
| status = 6 | raw_json.valorFrete | 71.908 | R$ 87.151,26 | 711 | 0.999% | -R$ 5.156.478,70 | 98.338% |
| status in (6,7) | raw_json.valorFrete | 71.928 | R$ 87.180,43 | 731 | 1.027% | -R$ 5.156.449,53 | 98.337% |
| status <> 8 | raw_json.valorFrete | 72.023 | R$ 87.215,43 | 826 | 1.160% | -R$ 5.156.414,53 | 98.337% |
| status in (1,3,6,7) | raw_json.valorFrete | 72.023 | R$ 87.215,43 | 826 | 1.160% | -R$ 5.156.414,53 | 98.337% |
| status = 6 com pedido | raw_json.percentualICMSPartilhaDestino | 71.188 | R$ 2.500,00 | -9 | 0.013% | -R$ 5.241.129,96 | 99.952% |
| status = 6 com pedido | raw_json.valorFaturado | 71.188 | R$ 1.578,08 | -9 | 0.013% | -R$ 5.242.051,88 | 99.970% |
| status = 6 com pedido | raw_json.baseIcms | 71.188 | R$ 1.578,08 | -9 | 0.013% | -R$ 5.242.051,88 | 99.970% |
| status = 6 com pedido | raw_json.valorDesconto | 71.188 | R$ 584,02 | -9 | 0.013% | -R$ 5.243.045,94 | 99.989% |
| status = 6 com pedido | raw_json.valorIcms | 71.188 | R$ 130,68 | -9 | 0.013% | -R$ 5.243.499,28 | 99.998% |
| status = 6 com pedido | raw_json.valorOutras | 71.188 | R$ 0,04 | -9 | 0.013% | -R$ 5.243.629,92 | 100.000% |
| status = 6 com pedido | raw_json.valorNotaComImpostos | 71.188 | R$ 0,00 | -9 | 0.013% | -R$ 5.243.629,96 | 100.000% |
| status = 6 com pedido | raw_json.valorServicos | 71.188 | R$ 0,00 | -9 | 0.013% | -R$ 5.243.629,96 | 100.000% |
| status = 6 com pedido | raw_json.valorSeguro | 71.188 | R$ 0,00 | -9 | 0.013% | -R$ 5.243.629,96 | 100.000% |
| status = 6 com pedido | raw_json.valorIpi | 71.188 | R$ 0,00 | -9 | 0.013% | -R$ 5.243.629,96 | 100.000% |

## Quantidade e Soma por Status

| Status | Qtde | Soma raw_json.valor |
| --- | --- | --- |
| 1 | 56 | R$ 5.228,25 |
| 3 | 39 | R$ 2.693,97 |
| 6 | 71.908 | R$ 5.014.631,93 |
| 7 | 20 | R$ 291.598,59 |
| 8 | 89 | R$ 1.750.174,08 |

## Quantidade e Soma por Data de Emissão

| Data | Qtde | Soma raw_json.valor |
| --- | --- | --- |
| 2026-06-01 | 3.146 | R$ 241.224,65 |
| 2026-06-02 | 2.984 | R$ 226.893,03 |
| 2026-06-03 | 3.596 | R$ 263.322,10 |
| 2026-06-04 | 3.243 | R$ 216.075,82 |
| 2026-06-05 | 3.673 | R$ 1.231.222,23 |
| 2026-06-06 | 5.954 | R$ 441.198,66 |
| 2026-06-07 | 4.274 | R$ 284.160,15 |
| 2026-06-08 | 4.286 | R$ 298.832,80 |
| 2026-06-09 | 3.838 | R$ 256.849,68 |
| 2026-06-10 | 4.079 | R$ 604.224,94 |
| 2026-06-11 | 3.589 | R$ 252.655,21 |
| 2026-06-12 | 3.250 | R$ 229.794,51 |
| 2026-06-13 | 2.955 | R$ 202.845,21 |
| 2026-06-14 | 4.324 | R$ 293.349,52 |
| 2026-06-15 | 4.986 | R$ 693.349,11 |
| 2026-06-16 | 4.131 | R$ 585.889,88 |
| 2026-06-17 | 3.884 | R$ 298.269,96 |
| 2026-06-18 | 3.081 | R$ 245.157,66 |
| 2026-06-19 | 2.839 | R$ 199.011,70 |

## Quantidade e Soma por Integração/Canal

| Canal | Qtde | Soma raw_json.valor |
| --- | --- | --- |
| (sem canal) | 864 | R$ 2.107.158,28 |
| Amazon | 688 | R$ 65.441,78 |
| Mercado Livre | 284 | R$ 26.767,83 |
| Mercado Livre Fulfillment | 2.720 | R$ 226.491,12 |
| Shein | 105 | R$ 12.114,30 |
| Shopee Donacor | 9.022 | R$ 599.661,14 |
| Shopee Jacartta | 8.221 | R$ 586.764,51 |
| Shopee Oliver | 11.205 | R$ 994.062,15 |
| Shopee toca | 10.345 | R$ 883.274,19 |
| TikTok Shop Donacor | 15.750 | R$ 695.336,34 |
| TikTok Shop Jacartta | 3.729 | R$ 295.232,19 |
| TikTok Shop Oliver | 8.569 | R$ 532.264,30 |
| TikTok Shop Toca | 610 | R$ 39.758,69 |

## Pedido Vinculado

| Grupo | Qtde | Soma raw_json.valor |
| --- | --- | --- |
| com pedido vinculado | 71.248 | R$ 4.957.168,54 |
| sem pedido vinculado | 864 | R$ 2.107.158,28 |

## Cobertura de Itens Hidratados

| Grupo | Qtde | Soma raw_json.valor |
| --- | --- | --- |
| com itens hidratados | 26 | R$ 2.887,08 |
| sem itens hidratados | 72.086 | R$ 7.061.439,74 |

## Campos de Data Testados

| Campo / Janela | Qtde | Soma raw_json.valor |
| --- | --- | --- |
| emission_date: dentro da janela | 72.112 | R$ 7.064.326,82 |
| raw_json.dataEmissao: dentro da janela | 72.112 | R$ 7.064.326,82 |
| raw_json.dataInclusao: dentro da janela | 25 | R$ 1.578,08 |
| raw_json.dataInclusao: fora da janela | 1 | R$ 1.309,00 |
| raw_json.dataPrevista: dentro da janela | 680 | R$ 63.303,21 |
| raw_json.dataPrevista: fora da janela | 67.876 | R$ 4.998.256,36 |

## Amostra de 20 NFs para Conferência Manual

A coluna `manual_screen_value` precisa ser preenchida olhando a tela da Olist. O payload abaixo é sanitizado para evitar CPF/CNPJ e dados pessoais sensíveis no repositório.

| NF | Status API | Data API | Valor Tela Olist | raw.valor | raw.valorProdutos | raw.valorFrete | Pedido |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 290550 | 6 | 2026-06-01 | preencher manualmente | R$ 5,90 | R$ 5,90 | R$ 0,00 | 260601VJCPDK1E |
| 290551 | 6 | 2026-06-01 | preencher manualmente | R$ 35,70 | R$ 99,90 | R$ 0,80 | 584299596331648672 |
| 290552 | 6 | 2026-06-01 | preencher manualmente | R$ 94,91 | R$ 99,90 | R$ 0,00 | 260601VJHJSETS |
| 290553 | 6 | 2026-06-01 | preencher manualmente | R$ 54,40 | R$ 109,90 | R$ 4,50 | 584299607283959376 |
| 290554 | 6 | 2026-06-01 | preencher manualmente | R$ 69,90 | R$ 69,90 | R$ 0,00 | 260601VJJBM0X8 |
| 290555 | 6 | 2026-06-01 | preencher manualmente | R$ 32,18 | R$ 99,90 | R$ 0,00 | 584299622252839987 |
| 290556 | 6 | 2026-06-01 | preencher manualmente | R$ 59,90 | R$ 59,88 | R$ 0,00 | 260601VJNCVKE4 |
| 290557 | 6 | 2026-06-01 | preencher manualmente | R$ 47,91 | R$ 47,91 | R$ 0,00 | 260601VJPG5HH9 |
| 290558 | 6 | 2026-06-01 | preencher manualmente | R$ 24,89 | R$ 24,89 | R$ 0,00 | 260601VJQR7CX3 |
| 290559 | 6 | 2026-06-01 | preencher manualmente | R$ 93,90 | R$ 93,90 | R$ 0,00 | 260601VJR5HCNM |
| 290560 | 6 | 2026-06-01 | preencher manualmente | R$ 69,90 | R$ 89,88 | R$ 0,00 | 584299693841352123 |
| 290561 | 6 | 2026-06-01 | preencher manualmente | R$ 54,90 | R$ 54,90 | R$ 0,00 | 260601VJTUC0C5 |
| 290562 | 6 | 2026-06-01 | preencher manualmente | R$ 54,90 | R$ 54,90 | R$ 0,00 | 260601VJUBHK3D |
| 290563 | 6 | 2026-06-01 | preencher manualmente | R$ 123,40 | R$ 129,90 | R$ 0,00 | 260601VJUSW4TS |
| 290564 | 6 | 2026-06-01 | preencher manualmente | R$ 47,90 | R$ 47,90 | R$ 0,00 | 260601VJVEVXRN |
| 290565 | 6 | 2026-06-01 | preencher manualmente | R$ 54,90 | R$ 54,90 | R$ 0,00 | 260601VJVV7MDD |
| 290566 | 6 | 2026-06-01 | preencher manualmente | R$ 44,90 | R$ 44,90 | R$ 0,00 | 260601VJW1W4XV |
| 290567 | 6 | 2026-06-01 | preencher manualmente | R$ 39,90 | R$ 49,90 | R$ 0,00 | 260601VK072CE8 |
| 290568 | 6 | 2026-06-01 | preencher manualmente | R$ 78,30 | R$ 189,90 | R$ 0,00 | 584299684629218571 |
| 290569 | 6 | 2026-06-01 | preencher manualmente | R$ 32,18 | R$ 99,90 | R$ 0,00 | 584299770227951364 |

<details>
<summary>Payload sanitizado da amostra</summary>

```json
[
  {
    "id": "360742690",
    "numero": "290550",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:02:00",
    "dataPrevista": "0000-00-00",
    "valor": 5.9,
    "valorProdutos": 5.9,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 5.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12756,
      "nome": "Shopee toca",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJCPDK1E",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "DF"
    }
  },
  {
    "id": "360742696",
    "numero": "290551",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:02:07",
    "dataPrevista": "0000-00-00",
    "valor": 35.7,
    "valorProdutos": 99.9,
    "valorFrete": 0.8,
    "valorDesconto": 65,
    "valorFaturado": 35.7,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 13799,
      "nome": "TikTok Shop Donacor",
      "canalVenda": "",
      "numeroPedidoEcommerce": "584299596331648672",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "RJ"
    }
  },
  {
    "id": "360742712",
    "numero": "290552",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:02:23",
    "dataPrevista": "0000-00-00",
    "valor": 94.91,
    "valorProdutos": 99.9,
    "valorFrete": 0,
    "valorDesconto": 4.99,
    "valorFaturado": 94.91,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12756,
      "nome": "Shopee toca",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJHJSETS",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "MG"
    }
  },
  {
    "id": "360742719",
    "numero": "290553",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:02:26",
    "dataPrevista": "0000-00-00",
    "valor": 54.4,
    "valorProdutos": 109.9,
    "valorFrete": 4.5,
    "valorDesconto": 60,
    "valorFaturado": 54.4,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 13222,
      "nome": "TikTok Shop Oliver",
      "canalVenda": "",
      "numeroPedidoEcommerce": "584299607283959376",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "RJ"
    }
  },
  {
    "id": "360742727",
    "numero": "290554",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:02:35",
    "dataPrevista": "0000-00-00",
    "valor": 69.9,
    "valorProdutos": 69.9,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 69.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12757,
      "nome": "Shopee Oliver",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJJBM0X8",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "PR"
    }
  },
  {
    "id": "360742736",
    "numero": "290555",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:03:00",
    "dataPrevista": "0000-00-00",
    "valor": 32.18,
    "valorProdutos": 99.9,
    "valorFrete": 0,
    "valorDesconto": 67.72,
    "valorFaturado": 32.18,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 13222,
      "nome": "TikTok Shop Oliver",
      "canalVenda": "",
      "numeroPedidoEcommerce": "584299622252839987",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "MG"
    }
  },
  {
    "id": "360742763",
    "numero": "290556",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:04:08",
    "dataPrevista": "0000-00-00",
    "valor": 59.9,
    "valorProdutos": 59.88,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 59.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12749,
      "nome": "Shopee Jacartta",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJNCVKE4",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "MG"
    }
  },
  {
    "id": "360742783",
    "numero": "290557",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:04:45",
    "dataPrevista": "0000-00-00",
    "valor": 47.91,
    "valorProdutos": 47.91,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 47.91,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12755,
      "nome": "Shopee Donacor",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJPG5HH9",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "PR"
    }
  },
  {
    "id": "360742818",
    "numero": "290558",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:05:53",
    "dataPrevista": "0000-00-00",
    "valor": 24.89,
    "valorProdutos": 24.89,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 24.89,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12757,
      "nome": "Shopee Oliver",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJQR7CX3",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "MG"
    }
  },
  {
    "id": "360742858",
    "numero": "290559",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:06:25",
    "dataPrevista": "0000-00-00",
    "valor": 93.9,
    "valorProdutos": 93.9,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 93.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12756,
      "nome": "Shopee toca",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJR5HCNM",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "RJ"
    }
  },
  {
    "id": "360742874",
    "numero": "290560",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:07:23",
    "dataPrevista": "0000-00-00",
    "valor": 69.9,
    "valorProdutos": 89.88,
    "valorFrete": 0,
    "valorDesconto": 20,
    "valorFaturado": 69.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 13799,
      "nome": "TikTok Shop Donacor",
      "canalVenda": "",
      "numeroPedidoEcommerce": "584299693841352123",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "PR"
    }
  },
  {
    "id": "360742878",
    "numero": "290561",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:07:25",
    "dataPrevista": "0000-00-00",
    "valor": 54.9,
    "valorProdutos": 54.9,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 54.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12755,
      "nome": "Shopee Donacor",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJTUC0C5",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "BA"
    }
  },
  {
    "id": "360742954",
    "numero": "290562",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:08:49",
    "dataPrevista": "0000-00-00",
    "valor": 54.9,
    "valorProdutos": 54.9,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 54.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12755,
      "nome": "Shopee Donacor",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJUBHK3D",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "BA"
    }
  },
  {
    "id": "360742965",
    "numero": "290563",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:08:52",
    "dataPrevista": "0000-00-00",
    "valor": 123.4,
    "valorProdutos": 129.9,
    "valorFrete": 0,
    "valorDesconto": 6.5,
    "valorFaturado": 123.4,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12757,
      "nome": "Shopee Oliver",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJUSW4TS",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "SP"
    }
  },
  {
    "id": "360742968",
    "numero": "290564",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:08:56",
    "dataPrevista": "0000-00-00",
    "valor": 47.9,
    "valorProdutos": 47.9,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 47.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12756,
      "nome": "Shopee toca",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJVEVXRN",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "RS"
    }
  },
  {
    "id": "360742974",
    "numero": "290565",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:08:58",
    "dataPrevista": "0000-00-00",
    "valor": 54.9,
    "valorProdutos": 54.9,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 54.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12756,
      "nome": "Shopee toca",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJVV7MDD",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "PR"
    }
  },
  {
    "id": "360742979",
    "numero": "290566",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:08:59",
    "dataPrevista": "0000-00-00",
    "valor": 44.9,
    "valorProdutos": 44.9,
    "valorFrete": 0,
    "valorDesconto": 0,
    "valorFaturado": 44.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12749,
      "nome": "Shopee Jacartta",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VJW1W4XV",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "RJ"
    }
  },
  {
    "id": "360743012",
    "numero": "290567",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:10:05",
    "dataPrevista": "0000-00-00",
    "valor": 39.9,
    "valorProdutos": 49.9,
    "valorFrete": 0,
    "valorDesconto": 10,
    "valorFaturado": 39.9,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 12756,
      "nome": "Shopee toca",
      "canalVenda": "",
      "numeroPedidoEcommerce": "260601VK072CE8",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "RJ"
    }
  },
  {
    "id": "360743031",
    "numero": "290568",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:10:40",
    "dataPrevista": "0000-00-00",
    "valor": 78.3,
    "valorProdutos": 189.9,
    "valorFrete": 0,
    "valorDesconto": 111.6,
    "valorFaturado": 78.3,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 13222,
      "nome": "TikTok Shop Oliver",
      "canalVenda": "",
      "numeroPedidoEcommerce": "584299684629218571",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "SP"
    }
  },
  {
    "id": "360743077",
    "numero": "290569",
    "situacao": "6",
    "dataEmissao": "2026-06-01",
    "dataInclusao": "2026-06-01 00:11:30",
    "dataPrevista": "0000-00-00",
    "valor": 32.18,
    "valorProdutos": 99.9,
    "valorFrete": 0,
    "valorDesconto": 67.72,
    "valorFaturado": 32.18,
    "valorNotaComImpostos": 0,
    "ecommerce": {
      "id": 13222,
      "nome": "TikTok Shop Oliver",
      "canalVenda": "",
      "numeroPedidoEcommerce": "584299770227951364",
      "numeroPedidoCanalVenda": ""
    },
    "cliente": {
      "uf": "SC"
    }
  }
]
```

</details>

## Conclusão

A reconciliação ainda não atingiu a tolerância. Próximo passo: comparar a amostra de 20 NFs na tela Olist para descobrir se a divergência vem de data visual, status visual, campo financeiro ou atualização posterior da base.

Enquanto não bater, manter a trava: não criar `oraculo_fiscal_daily_revenue`, `oraculo_fiscal_sku_sales`, `oraculo_fiscal_channel_sales` e não migrar dashboard/margem/ROI.

## Investigação de Notas Excedentes

Arquivo CSV de possíveis excedentes: `reports/olist-invoice-reconciliation-excess-2026-06-01-2026-06-19.csv`

### Base Comparada

- Base API candidata: status in (6,7): 71.928 NFs, R$ 5.306.230,52.
- Alvo tela Olist: 71.197 NFs, R$ 5.243.629,96.
- Delta da base candidata: 731 NFs, R$ 62.600,56.

### Status Separados

- status 6: 71.908 NFs, R$ 5.014.631,93.
- status 7: 20 NFs, R$ 291.598,59.
- status 8: 89 NFs, R$ 1.750.174,08.
- demais status: 95 NFs, R$ 7.922,22.

### Melhor Filtro Encontrado

- Filtro: status in (6,7) excluindo nature=E
- Resultado: 71.198 NFs, R$ 5.243.715,76.
- Delta quantidade: 1 (0.001%).
- Delta valor: R$ 85,80 (0.002%).
- Registros excluídos por esse filtro: 730 NFs, R$ 62.514,76.

Esse filtro atinge o critério de aceite estatístico. Ainda precisa validação manual em tela antes de criar views oficiais.

### Combinações Mais Próximas

| Filtro | Qtde | Valor | Delta Qtde | Delta Qtde % | Delta Valor | Delta Valor % | Excluídas | Valor Excluído |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| status in (6,7) excluindo nature=E | 71.198 | R$ 5.243.715,76 | 1 | 0.001% | R$ 85,80 | 0.002% | 730 | R$ 62.514,76 |
| somente type=S | 71.198 | R$ 5.243.715,76 | 1 | 0.001% | R$ 85,80 | 0.002% | 730 | R$ 62.514,76 |
| status in (6,7) excluindo type=E | 71.198 | R$ 5.243.715,76 | 1 | 0.001% | R$ 85,80 | 0.002% | 730 | R$ 62.514,76 |
| status in (6,7) excluindo raw_json.tipo=E | 71.198 | R$ 5.243.715,76 | 1 | 0.001% | R$ 85,80 | 0.002% | 730 | R$ 62.514,76 |
| status in (6,7) excluindo raw_json.origem.tipo=devolucao | 71.198 | R$ 5.243.715,76 | 1 | 0.001% | R$ 85,80 | 0.002% | 730 | R$ 62.514,76 |
| status in (6,7) excluindo raw_json.cliente.endereco.pais=(vazio) | 71.198 | R$ 5.243.715,76 | 1 | 0.001% | R$ 85,80 | 0.002% | 730 | R$ 62.514,76 |
| somente nature=S | 71.173 | R$ 5.242.137,68 | -24 | 0.034% | -R$ 1.492,28 | 0.028% | 755 | R$ 64.092,84 |
| status in (6,7) excluindo uf=PB | 71.203 | R$ 5.246.796,78 | 6 | 0.008% | R$ 3.166,82 | 0.060% | 725 | R$ 59.433,74 |
| status in (6,7) excluindo raw_json.cliente.endereco.uf=PB | 71.203 | R$ 5.246.796,78 | 6 | 0.008% | R$ 3.166,82 | 0.060% | 725 | R$ 59.433,74 |
| status in (6,7) excluindo channel=Amazon | 71.240 | R$ 5.240.788,74 | 43 | 0.060% | -R$ 2.841,22 | 0.054% | 688 | R$ 65.441,78 |
| status in (6,7) excluindo ecommerce_id=12758 | 71.240 | R$ 5.240.788,74 | 43 | 0.060% | -R$ 2.841,22 | 0.054% | 688 | R$ 65.441,78 |
| status in (6,7) excluindo ecommerce_name=Amazon | 71.240 | R$ 5.240.788,74 | 43 | 0.060% | -R$ 2.841,22 | 0.054% | 688 | R$ 65.441,78 |
| status in (6,7) excluindo raw_json.ecommerce.id=12758 | 71.240 | R$ 5.240.788,74 | 43 | 0.060% | -R$ 2.841,22 | 0.054% | 688 | R$ 65.441,78 |
| status in (6,7) excluindo raw_json.ecommerce.nome=Amazon | 71.240 | R$ 5.240.788,74 | 43 | 0.060% | -R$ 2.841,22 | 0.054% | 688 | R$ 65.441,78 |
| status in (6,7) excluindo raw_json.idFormaEnvio=341073841 | 71.240 | R$ 5.240.788,74 | 43 | 0.060% | -R$ 2.841,22 | 0.054% | 688 | R$ 65.441,78 |
| status in (6,7) excluindo uf=MT | 71.236 | R$ 5.252.628,12 | 39 | 0.055% | R$ 8.998,16 | 0.172% | 692 | R$ 53.602,40 |
| status in (6,7) excluindo raw_json.cliente.endereco.uf=MT | 71.236 | R$ 5.252.628,12 | 39 | 0.055% | R$ 8.998,16 | 0.172% | 692 | R$ 53.602,40 |
| status in (6,7) excluindo uf=MS | 71.028 | R$ 5.239.524,78 | -169 | 0.237% | -R$ 4.105,18 | 0.078% | 900 | R$ 66.705,74 |
| status in (6,7) excluindo raw_json.cliente.endereco.uf=MS | 71.028 | R$ 5.239.524,78 | -169 | 0.237% | -R$ 4.105,18 | 0.078% | 900 | R$ 66.705,74 |
| status in (6,7) excluindo raw_json.enderecoEntrega.uf=BA | 71.123 | R$ 5.257.268,55 | -74 | 0.104% | R$ 13.638,59 | 0.260% | 805 | R$ 48.961,97 |
| status in (6,7) excluindo raw_json.enderecoEntrega.uf=ES | 71.154 | R$ 5.262.033,04 | -43 | 0.060% | R$ 18.403,08 | 0.351% | 774 | R$ 44.197,48 |
| status in (6,7) excluindo uf=RN | 71.337 | R$ 5.258.728,29 | 140 | 0.197% | R$ 15.098,33 | 0.288% | 591 | R$ 47.502,23 |
| status in (6,7) excluindo raw_json.cliente.endereco.uf=RN | 71.337 | R$ 5.258.728,29 | 140 | 0.197% | R$ 15.098,33 | 0.288% | 591 | R$ 47.502,23 |
| status in (6,7) excluindo raw_json.enderecoEntrega.uf=GO | 71.287 | R$ 5.263.128,93 | 90 | 0.126% | R$ 19.498,97 | 0.372% | 641 | R$ 43.101,59 |
| status in (6,7) excluindo uf=MA | 71.369 | R$ 5.257.419,26 | 172 | 0.242% | R$ 13.789,30 | 0.263% | 559 | R$ 48.811,26 |
| status in (6,7) excluindo raw_json.cliente.endereco.uf=MA | 71.369 | R$ 5.257.419,26 | 172 | 0.242% | R$ 13.789,30 | 0.263% | 559 | R$ 48.811,26 |
| status in (6,7) excluindo uf=AL | 71.338 | R$ 5.260.608,31 | 141 | 0.198% | R$ 16.978,35 | 0.324% | 590 | R$ 45.622,21 |
| status in (6,7) excluindo raw_json.cliente.endereco.uf=AL | 71.338 | R$ 5.260.608,31 | 141 | 0.198% | R$ 16.978,35 | 0.324% | 590 | R$ 45.622,21 |
| status in (6,7) excluindo raw_json.enderecoEntrega.uf=RS | 70.839 | R$ 5.240.715,94 | -358 | 0.503% | -R$ 2.914,02 | 0.056% | 1.089 | R$ 65.514,58 |
| status in (6,7) excluindo channel=TikTok Shop Toca | 71.318 | R$ 5.266.471,83 | 121 | 0.170% | R$ 22.841,87 | 0.436% | 610 | R$ 39.758,69 |

### Agrupamento por Status

| Grupo | Qtde | Valor |
| --- | --- | --- |
| 6 | 71.908 | R$ 5.014.631,93 |
| 8 | 89 | R$ 1.750.174,08 |
| 7 | 20 | R$ 291.598,59 |
| 1 | 56 | R$ 5.228,25 |
| 3 | 39 | R$ 2.693,97 |

### Agrupamento por Integração/Canal e Status

| Grupo | Qtde | Valor |
| --- | --- | --- |
| (sem canal) / status 8 | 89 | R$ 1.750.174,08 |
| Shopee Oliver / status 6 | 11.201 | R$ 993.833,25 |
| Shopee toca / status 6 | 10.337 | R$ 882.795,74 |
| TikTok Shop Donacor / status 6 | 15.748 | R$ 695.210,62 |
| Shopee Donacor / status 6 | 9.017 | R$ 599.285,19 |
| Shopee Jacartta / status 6 | 8.216 | R$ 586.327,59 |
| TikTok Shop Oliver / status 6 | 8.569 | R$ 532.264,30 |
| TikTok Shop Jacartta / status 6 | 3.729 | R$ 295.232,19 |
| (sem canal) / status 7 | 17 | R$ 291.378,97 |
| Mercado Livre Fulfillment / status 6 | 2.686 | R$ 223.797,15 |
| Amazon / status 6 | 688 | R$ 65.441,78 |
| (sem canal) / status 6 | 720 | R$ 61.940,10 |
| TikTok Shop Toca / status 6 | 610 | R$ 39.758,69 |
| Mercado Livre / status 6 | 284 | R$ 26.767,83 |
| Shein / status 6 | 103 | R$ 11.977,50 |
| (sem canal) / status 1 | 38 | R$ 3.665,13 |
| Mercado Livre Fulfillment / status 3 | 34 | R$ 2.693,97 |
| Shopee toca / status 1 | 7 | R$ 478,45 |
| Shopee Jacartta / status 1 | 5 | R$ 436,92 |
| Shopee Donacor / status 1 | 1 | R$ 282,05 |
| Shopee Oliver / status 1 | 3 | R$ 228,90 |
| Shein / status 1 | 2 | R$ 136,80 |
| TikTok Shop Donacor / status 7 | 2 | R$ 125,72 |
| Shopee Donacor / status 7 | 1 | R$ 93,90 |
| Shopee toca / status 3 | 1 | R$ 0,00 |
| Shopee Oliver / status 3 | 1 | R$ 0,00 |
| Shopee Donacor / status 3 | 3 | R$ 0,00 |

### Agrupamento por Empresa/Conta/Loja

| Grupo | Qtde | Valor |
| --- | --- | --- |
| (sem empresa/loja) | 72.112 | R$ 7.064.326,82 |

### Agrupamento por Tipo/Natureza/Finalidade/Origem

Natureza:

| Grupo | Qtde | Valor |
| --- | --- | --- |
| S | 71.230 | R$ 5.246.394,77 |
| E | 856 | R$ 1.815.044,97 |
| 1 | 26 | R$ 2.887,08 |

Tipo:

| Grupo | Qtde | Valor |
| --- | --- | --- |
| S | 71.255 | R$ 5.247.972,85 |
| E | 857 | R$ 1.816.353,97 |

Finalidade:

| Grupo | Qtde | Valor |
| --- | --- | --- |
| (sem finalidade) | 72.086 | R$ 7.061.439,74 |
| 1 | 26 | R$ 2.887,08 |

Origem:

| Grupo | Qtde | Valor |
| --- | --- | --- |
| null | 96 | R$ 1.750.637,70 |
| {"id":"361395257","tipo":"venda"} | 1 | R$ 143.473,80 |
| {"id":"361397377","tipo":"venda"} | 1 | R$ 141.423,60 |
| {"id":"360956453","tipo":"venda"} | 1 | R$ 3.900,00 |
| {"id":"362212792","tipo":"venda"} | 1 | R$ 2.374,90 |
| {"id":"362126606","tipo":"venda"} | 1 | R$ 1.872,00 |
| {"id":"362562739","tipo":"venda"} | 1 | R$ 1.038,70 |
| {"id":"361967197","tipo":"venda"} | 1 | R$ 1.012,40 |
| {"id":"362887973","tipo":"venda"} | 1 | R$ 881,87 |
| {"id":"362488604","tipo":"venda"} | 1 | R$ 852,40 |
| {"id":"362859002","tipo":"venda"} | 1 | R$ 738,68 |
| {"id":"362538892","tipo":"venda"} | 1 | R$ 731,80 |
| {"id":"363053828","tipo":"venda"} | 1 | R$ 731,80 |
| {"id":"361484945","tipo":"venda"} | 1 | R$ 710,10 |
| {"id":"361237234","tipo":"venda"} | 1 | R$ 698,80 |
| {"id":"361736156","tipo":"venda"} | 1 | R$ 696,82 |
| {"id":"362363514","tipo":"venda"} | 1 | R$ 696,73 |
| {"id":"362186913","tipo":"venda"} | 1 | R$ 693,82 |
| {"id":"361516766","tipo":"venda"} | 1 | R$ 687,30 |
| {"id":"361516768","tipo":"venda"} | 1 | R$ 687,30 |
| {"id":"361552918","tipo":"venda"} | 1 | R$ 674,90 |
| {"id":"362054399","tipo":"venda"} | 1 | R$ 666,60 |
| {"id":"362453386","tipo":"venda"} | 1 | R$ 659,60 |
| {"id":"361311719","tipo":"venda"} | 1 | R$ 649,80 |
| {"id":"21237","tipo":"devolucao"} | 1 | R$ 649,80 |
| {"id":"360692692","tipo":"venda"} | 1 | R$ 648,70 |
| {"id":"361124838","tipo":"venda"} | 1 | R$ 648,70 |
| {"id":"361381554","tipo":"venda"} | 1 | R$ 648,70 |
| {"id":"361330147","tipo":"venda"} | 1 | R$ 620,06 |
| {"id":"362207070","tipo":"venda"} | 1 | R$ 613,93 |
| {"id":"20449","tipo":"devolucao"} | 1 | R$ 603,43 |
| {"id":"362784658","tipo":"venda"} | 1 | R$ 587,48 |
| {"id":"362831408","tipo":"venda"} | 1 | R$ 584,90 |
| {"id":"361378142","tipo":"venda"} | 1 | R$ 582,82 |
| {"id":"362200451","tipo":"venda"} | 1 | R$ 579,00 |
| {"id":"362141083","tipo":"venda"} | 1 | R$ 541,40 |
| {"id":"361673493","tipo":"venda"} | 1 | R$ 528,00 |
| {"id":"361260505","tipo":"venda"} | 1 | R$ 524,50 |
| {"id":"19611","tipo":"devolucao"} | 1 | R$ 522,70 |
| {"id":"362371210","tipo":"venda"} | 1 | R$ 515,30 |
| {"id":"361815417","tipo":"venda"} | 1 | R$ 511,88 |
| {"id":"361734636","tipo":"venda"} | 1 | R$ 509,32 |
| {"id":"362191263","tipo":"venda"} | 1 | R$ 501,90 |
| {"id":"361849209","tipo":"venda"} | 1 | R$ 501,60 |
| {"id":"20729","tipo":"devolucao"} | 1 | R$ 498,46 |
| {"id":"361579558","tipo":"venda"} | 1 | R$ 494,20 |
| {"id":"361539809","tipo":"venda"} | 1 | R$ 493,43 |
| {"id":"361539820","tipo":"venda"} | 1 | R$ 493,43 |
| {"id":"361549010","tipo":"venda"} | 1 | R$ 493,43 |
| {"id":"362213015","tipo":"venda"} | 1 | R$ 484,70 |
| {"id":"361507019","tipo":"venda"} | 1 | R$ 479,40 |
| {"id":"362793889","tipo":"venda"} | 1 | R$ 479,40 |
| {"id":"362577358","tipo":"venda"} | 1 | R$ 474,80 |
| {"id":"361498817","tipo":"venda"} | 1 | R$ 473,40 |
| {"id":"362943867","tipo":"venda"} | 1 | R$ 470,00 |
| {"id":"361085231","tipo":"venda"} | 1 | R$ 469,96 |
| {"id":"362841374","tipo":"venda"} | 1 | R$ 461,00 |
| {"id":"20112","tipo":"devolucao"} | 1 | R$ 460,76 |
| {"id":"362962783","tipo":"venda"} | 1 | R$ 453,60 |
| {"id":"363206260","tipo":"venda"} | 1 | R$ 452,58 |
| {"id":"362590498","tipo":"venda"} | 1 | R$ 451,29 |
| {"id":"361615440","tipo":"venda"} | 1 | R$ 439,21 |
| {"id":"361809708","tipo":"venda"} | 1 | R$ 430,20 |
| {"id":"361044945","tipo":"venda"} | 1 | R$ 428,24 |
| {"id":"363206851","tipo":"venda"} | 1 | R$ 428,15 |
| {"id":"362503204","tipo":"venda"} | 1 | R$ 426,53 |
| {"id":"362949774","tipo":"venda"} | 1 | R$ 424,42 |
| {"id":"362407256","tipo":"venda"} | 1 | R$ 423,51 |
| {"id":"361070826","tipo":"venda"} | 1 | R$ 423,38 |
| {"id":"361062989","tipo":"venda"} | 1 | R$ 423,00 |
| {"id":"362689659","tipo":"venda"} | 1 | R$ 418,21 |
| {"id":"361159444","tipo":"venda"} | 1 | R$ 417,90 |
| {"id":"361266318","tipo":"venda"} | 1 | R$ 415,10 |
| {"id":"363086962","tipo":"venda"} | 1 | R$ 414,30 |
| {"id":"361232611","tipo":"venda"} | 1 | R$ 411,31 |
| {"id":"363184562","tipo":"venda"} | 1 | R$ 408,30 |
| {"id":"362610018","tipo":"venda"} | 1 | R$ 407,25 |
| {"id":"362044972","tipo":"venda"} | 1 | R$ 404,91 |
| {"id":"362073006","tipo":"venda"} | 1 | R$ 404,91 |
| {"id":"362950851","tipo":"venda"} | 1 | R$ 403,96 |

### Conclusão da Investigação de Excedentes

Foi encontrado um filtro candidato dentro da tolerância. Não promover para views oficiais até a conferência manual confirmar que essas notas realmente não aparecem na aba emitidas da Olist.

## Camada Fiscal Oficial Aprovada

Em `2026-06-22`, a reconciliação foi considerada validada pelo usuário.

Regra oficial:

- status em `6` ou `7`;
- excluir `tipo = E`;
- excluir `raw_json.origem.tipo = devolucao`;
- usar data de emissão da NF como data fiscal;
- usar o valor fiscal validado da NF como receita faturada oficial.

Resultado para `2026-06-01` a `2026-06-19`:

- Tela Olist: `71.197` NFs / `R$ 5.243.629,96`;
- Supabase filtrado: `71.198` NFs / `R$ 5.243.715,76`;
- diferença: `+1` NF / `+R$ 85,80`;
- status: dentro da tolerância.

Objetos criados:

- view `oraculo_fiscal_invoices_valid`;
- view `oraculo_fiscal_daily_revenue`;
- view `oraculo_fiscal_channel_sales`;
- RPC `oraculo_fiscal_metrics(start_date, end_date)`;
- RPC `oraculo_fiscal_channel_metrics(start_date, end_date)`;
- script `scripts/audit-oraculo-fiscal-metrics.js`.

Validação do script:

```text
Periodo fiscal: 2026-06-01 a 2026-06-19
NFs faturadas validas: 71.198
Receita faturada: R$ 5.243.715,76
Ticket medio faturado: R$ 73,65
NFs com pedido vinculado: 71.191
Devolucoes/tipo E: 857 / R$ 1.816.353,97
Canceladas/status 8: 89 / R$ 1.750.174,08
```

`oraculo_fiscal_sku_sales` não foi criada nesta etapa. A cobertura atual de itens fiscais ainda é baixa: apenas `25` NFs válidas com itens hidratados contra `71.198` NFs fiscais válidas no período validado.

Trava mantida: não migrar margem, ROI, ROAS, lucro ou SKUs oficiais enquanto `olist_invoice_items` não estiver com cobertura auditada.
