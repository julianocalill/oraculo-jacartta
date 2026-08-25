# Status do projeto — 2026-08-25

Este registro complementa o panorama amplo de
[`project-status-2026-08-21.md`](project-status-2026-08-21.md) e as entregas de
[`project-status-2026-08-24.md`](project-status-2026-08-24.md).

## Nova aba Reconciliação

`/reconciliacao` cruza quatro valores por pedido Shopee sem misturar seus
significados:

- **Bruto**: total do pedido na Shopee;
- **NF**: soma de `olist_invoices.total_amount` das NFs de venda válidas ligadas
  ao número do pedido — nunca o valor de `olist_invoice_items`;
- **A receber**: `escrow_amount` quando liberado ou
  `estimated_escrow_amount` enquanto pendente;
- **Pago carteira**: crédito efetivo `ESCROW_VERIFIED_ADD` do extrato da
  carteira. **Saldo após** é o saldo total da carteira depois desse crédito, não
  o pagamento do pedido.

A tela filtra por data do pedido, loja e situação, mostra previsão de liberação
quando a Shopee a informa e usa “Aguardando conclusão” quando
`estimated_payout_time=0`. O alerta distingue `Confere`, `Divergente`,
`A receber` e `Dado ausente`. Diferença entre bruto e NF aparece como contexto,
mas não vira automaticamente divergência de repasse — frete pago pelo comprador
pode explicar essa diferença.

O volume real exige paginação server-side de 100 linhas. Os cards são calculados
no conjunto integral filtrado pela RPC `shopee_reconciliation_summary`, não
somados apenas sobre a página visível.

## Ingestão e segurança

A Edge Function `shopee-reconciliation-sync` lê, por loja:

- `payment.get_wallet_transaction_list`, em blocos de 14 dias;
- `payment.get_income_detail` com `income_status=2`;
- `shopee_orders`, `shopee_order_escrow` e
  `oraculo_fiscal_invoices_valid` para enriquecer o cruzamento.

Ela nunca renova token: essa propriedade continua exclusiva do sincronizador
Shopee primário. A função assina cada loja com sua própria partner app.

`shopee_order_reconciliation` e `shopee_reconciliation_sync_state` são
`service_role`-only. O extrato financeiro por pedido não fica disponível ao
papel `authenticated`; o Server Component consulta com admin somente depois de
`requireTabAccess("reconciliacao")`.

## Paginação retomável e cron semanal

A medição em produção invalidou o desenho de uma chamada única:

- uma página de 100 pendências leva cerca de 6–7 s;
- Jacartta tinha 10.829 rendas pendentes;
- os créditos de carteira de 01/08 até a carga chegaram a 10–28 mil por loja.

Carteira e pendências avançam em lotes de quatro páginas; seus cursores ficam em
`shopee_reconciliation_sync_state`. Uma interrupção retoma da próxima página,
sem reiniciar nem duplicar. O domingo reserva até 90 chamadas curtas por loja,
escalonadas entre 05h e 19h59 BRT. Depois que o ciclo termina, as chamadas
restantes encerram sem consultar a Shopee. `/status` só considera saudável o
ciclo integral concluído das quatro lojas e alerta após oito dias.

## Carga inicial de agosto

Filtro auditado: **01/08/2026 a 25/08/2026**, pela data do pedido:

| métrica | valor |
|---|---:|
| Pedidos | 88.211 |
| Valor bruto | R$ 5.358.779,77 |
| Valor total das NFs localizadas | R$ 5.055.661,54 |
| Pedidos pendentes | 28.257 |
| Pendente a receber | R$ 1.220.418,47 |
| Pendências com previsão informada | 43 |
| Pendências aguardando previsão | 28.214 |
| Pedidos liberados | 59.954 |
| Pago na carteira | R$ 2.534.472,77 |
| Divergências reais entre líquido e crédito | 428 |
| Créditos sem líquido esperado no cache | 971 |
| Pedidos sem NF localizada | 1.715 |

Os quatro estados terminaram com `cycle_active=false`,
`pending_complete=true`, `wallet_complete=true` e um run final `success` por
loja. Totais lidos nas APIs durante a carga (podem incluir pedidos anteriores a
agosto, pois a Shopee ignora a data ao listar pendências):

| loja | créditos de carteira | rendas pendentes |
|---|---:|---:|
| Jacartta | 21.991 | 10.829 |
| Espaço de Bicho | 10.012 | 2.785 |
| Donacor | 26.409 | 6.697 |
| Oliverhome | 28.593 | 7.982 |

## Validação

- quatro ciclos completos e quatro runs finais `success` em produção;
- 55 testes de domínio aprovados;
- TypeScript sem erros;
- build de produção do Next.js aprovado, incluindo a rota `/reconciliacao`;
- tabela, colunas, estado e função de resumo documentados com `COMMENT ON`.

Arquivos centrais:

- `apps/web/app/reconciliacao/page.tsx`;
- `supabase/functions/shopee-reconciliation-sync/index.ts`;
- `supabase/migrations/20260825185746_shopee_reconciliation.sql`;
- `supabase/migrations/20260825191649_shopee_reconciliation_resume_state.sql`;
- `supabase/migrations/20260825192250_shopee_reconciliation_wallet_cursor.sql`;
- `supabase/migrations/20260825202209_shopee_reconciliation_summary.sql`.
