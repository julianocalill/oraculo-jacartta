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
