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
