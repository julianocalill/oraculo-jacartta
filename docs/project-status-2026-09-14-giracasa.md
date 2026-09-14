# Status da Giracasa — 14/09/2026

## Conferência fiscal da carga inicial

Conferência somente leitura da janela fechada de 30/07/2026 a 07/09/2026, no
schema `giracasa`, motor `gira-casa-v1`. A operação continua `enabled=false` e
sem usuários.

**Veredito: a carga está íntegra; o resultado financeiro não está aprovado.**
O lucro troca de sinal conforme uma premissa fiscal que depende de parecer do
contador.

### O que confere

| Verificação | Resultado |
| --- | --- |
| Receita oficial | 22.925 NFs de saída válidas, R$ 1.431.405,94, reconciliadas com a contagem bruta por status e tipo |
| Canário de 07/09 | 687 NFs e R$ 44.042,64, igual à conferência de 08/09 |
| Vínculo NF→pedido | Todas as NFs válidas vinculadas; 32 `unmatched` são pedidos anteriores a 30/07, fora da carga |
| Itens | 100% da receita com item; 95,7% com custo |
| ICMS | Nenhuma divergência da matriz SP em 23.072 linhas |
| DIFAL | Zero em SP, nenhum negativo, alíquotas coerentes com as internas de destino |
| Lucro por linha | Recalculado: nenhuma divergência |

### Achados

1. **Lucro depende do crédito de PIS/COFINS.** Com o crédito de 9,25% sobre o
   custo de compra, o lucro é R$ 41.031 (3,54%). Sem ele, −R$ 6.191 (−0,53%).
   `oraculo_financial_product_rules` está vazia: nenhum custo líquido ou
   transferência importada cadastrado, e o crédito de ICMS nas compras não é
   modelado. Produtos nacionais dão −R$ 7,8 mil mesmo com o crédito.
2. **471 NFs válidas (R$ 32.851,81) pertencem a pedidos cancelados** na Olist,
   espalhadas pela janela, nenhuma com NF de devolução.
3. **Margem e ROI do resumo estavam errados**: 3,00% e 6,81% exibidos contra
   3,54% e 8,04% corretos. O cálculo dividia pela receita de linhas sem lucro
   (TikTok e Mercado Livre sem tarifa). Mesmo defeito na margem por SKU e no
   snapshot. Uberlândia usa a mesma fórmula, mas confere (8,20% / 19,05%).
   Correção na migration `20260914120000_giracasa_margin_only_profitable_lines.sql`;
   **aplicação em produção pendente de autorização**.
4. **Tarifa só da Shopee.** TikTok e Mercado Livre (19% da receita) ficam sem
   lucro, como o contrato exige.
5. **Loja Shopee Vari Útil não autorizada** (R$ 258 mil na janela). Só a loja
   `984950642` está conectada, e a carga Shopee continua no canário de 87
   pedidos.
6. **Lacuna de custo é cadastro** (R$ 61,5 mil): itens de NF sem id de produto;
   33 SKUs ausentes do catálogo e 15 duplicados (84 SKUs duplicados no total).
7. `oraculo_fiscal_metrics` rotula como "canceladas" as NFs de status 8
   (entrada registrada) nas duas operações; as canceladas reais são status 3.
   Não corrigido: afeta Uberlândia.
8. `oraculo_olist_period_coverage` retorna zero porque não existe cron
   `giracasa` para o cache de quantidades. Esperado até a ativação.

### Decisões do contador

Planilha de revisão gerada em
`outputs/giracasa-conferencia-fiscal-40d-2026-09-14.xlsx` (fora do Git, contém
chaves de NF): perguntas, cenário com e sem crédito de PIS/COFINS, as 471 NFs
com campo de decisão e os 62 SKUs sem custo. O parecer escrito deve virar ADR
antes da ativação.

## Próximos gates

1. Parecer do contador sobre crédito de PIS/COFINS, ICMS de entrada e NFs de
   pedidos cancelados.
2. Aplicar a correção de margem em produção.
3. Cadastro dos SKUs faltantes e duplicados na Olist da Giracasa.
4. Autorizar a loja Shopee Vari Útil e cadastrar tarifas de TikTok e Mercado Livre.
5. Carga histórica Shopee por loja, preview com usuário de teste e só então
   crons, grants e `enabled=true`.
