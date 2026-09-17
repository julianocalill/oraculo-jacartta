# Status da Giracasa — 17/09/2026

## Motor financeiro gira-casa-v2

O contador respondeu às perguntas da conferência e o motor foi reescrito segundo
a regra dele: **custo = custo − ICMS − PIS/COFINS**, impostos conforme a tabela
enviada, PIS/COFINS de 9,25%.

Resultado na janela conferida (30/07 a 07/09):

| | v1 | v2 |
| --- | ---: | ---: |
| Lucro | R$ 41.031 | **R$ 85.568** |
| Margem | 3,54% | **7,37%** |
| ROI | 8,04% | **20,11%** |
| Custo | R$ 602.280 | R$ 501.381 |
| PIS/COFINS | R$ 71.008 | R$ 126.716 |
| DIFAL | R$ 97.759 | R$ 89.659 |

O ICMS de saída não muda (R$ 156.785,81). A cobertura de custo segue em 95,70%.

## ICMS da compra medido, não suposto

As notas de entrada foram carregadas de dez/2025 a set/2026 (1.883 notas), com o
filtro `tipo=E` acrescentado à sync de notas. Alíquotas medidas: **nacional 12%**
(Entrerios/SC), **importado 4%** (Jacartta/MG) e **18%** nas compras dentro de SP.

O motor usa a última compra de cada produto; kit soma o custo líquido dos
componentes. Hoje 148 produtos têm alíquota vinda de nota e nenhum kit ficou
parcial; o restante usa a média por origem.

A NF 000001 da Jacartta (24/07, R$ 179.726,40) saiu com ICMS zero por erro
pontual e está registrada como exceção de 4% em
`giracasa.oraculo_purchase_icms_overrides`.

## Estado

- Migration `20260917120000_giracasa_engine_v2.sql` escrita e **ensaiada em
  produção dentro de transação revertida**; não foi aplicada.
- 93 testes do domínio passam, incluindo um que prova que o DIFAL de Uberlândia
  continua com a tabela de 2026.
- Edge Function `giracasa-olist-sync-invoices` v13 publicada (filtro `tipo`).
- Operação segue `enabled=false`, sem usuários.

## Pendências

1. Aplicar a migration em produção.
2. Apuração de agosto do escritório para comparar com o Oráculo.
3. Decisão sobre as 471 NFs de pedidos cancelados (R$ 32.851,81).
4. Tarifas de TikTok e Mercado Livre (19% da receita sem lucro calculável).
5. Cadastro dos 33 SKUs ausentes e dos 15 duplicados.
6. Loja Shopee Vari Útil e cron que mantenha o token da Olist renovado.
