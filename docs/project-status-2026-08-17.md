# Estado do projeto — 17/08/2026

## Relatório Shopee de separação em caixas

O workflow `GJHOwusnuXgaxVaT` mantém os envios diários às `07:00` e `13:30`.

Foi adicionada uma janela especial para o slot de segunda-feira às `13:30`:

- início: sábado às `13:30`;
- fim: segunda-feira às `13:00`;
- conteúdo: vendas de sábado, domingo e segunda-feira dentro desses limites.

O slot de segunda-feira às `07:00` permanece com a regra diária normal, de
domingo às `14:00` até segunda às `06:30`. Por isso, o consolidado das `13:30`
repete deliberadamente os pedidos desse intervalo.

A regra está implementada tanto na função testável local quanto no código do nó
`Definir período e modo`, gerado por
`scripts/setup-n8n-shopee-sales-direct-whatsapp.js`.

A coleta direta também repete automaticamente chamadas GET que sofram falha de
rede transitória, necessária porque a janela de fim de semana consulta um volume
maior de pedidos nas quatro lojas.

## CSV enxuto com SKU Olist

O CSV anexo passou a conter somente `SKU`, `produto`,
`unidades_vendidas_unitariamente`, `caixas_completas` e `unidades_avulsas`.
`SKU` é sempre o SKU Olist, carregado da análise de preço-produto para a tabela
operacional `shopee_olist_sku_mappings`; não há fallback para SKU Shopee.

A carga de 17/08 materializou 1.068 vínculos inequívocos. Uma prévia real sem
WhatsApp gerou 117 linhas: 111 com SKU Olist e seis vazias por falta de vínculo.
