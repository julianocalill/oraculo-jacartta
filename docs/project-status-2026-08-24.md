# Status do projeto — 2026-08-24

Este registro complementa o panorama amplo de
[`project-status-2026-08-21.md`](project-status-2026-08-21.md) e as entregas de
[`project-status-2026-08-23.md`](project-status-2026-08-23.md).

## Acesso individual à aba Parâmetros

`/parametros` permanece uma aba restrita: os administradores fixos entram
automaticamente e usuários comuns só entram quando recebem uma concessão
explícita em `app_metadata.restricted_tabs`. Esse campo é separado do
`app_metadata.tabs` comum de propósito: o backfill histórico gravou a chave
`parametros` em vários usuários, e reaproveitá-la reabriria a tela sem intenção.

O painel `/usuarios` ganhou o grupo **Restrito**; essas abas não entram no botão
"Marcar todas". Daniel Merola (`daniel.merola@oliverhome.com.br`) é o primeiro
usuário com a concessão individual de Parâmetros.

## Expedição: vendas e carga operacional

A auditoria de produção confirmou que `/expedicao` estava correto como funil
operacional, mas não era comparável diretamente ao vendido: a tela agrupava
pacotes pelo prazo de envio (`ship_by_at`), enquanto a venda é medida pela data
do pagamento (`pay_time`). Em 23/08, por exemplo, houve 2.369 pedidos pagos e
zero pacotes com prazo naquele domingo.

A tela agora apresenta blocos separados:

- pedidos pagos e unidades vendidas pela data do pagamento;
- pacotes dessas vendas e vendas ainda sem pacote;
- carga operacional, bipes e coleta pelo prazo de envio;
- histórico diário com as duas bases lado a lado e rótulos explícitos.

Nova RPC `oraculo_fulfillment_sales_daily`, com índice parcial em
`shopee_orders.pay_time`. Ela é `security invoker` e `service_role`-only: as
tabelas de pedidos e itens carregam dados pessoais de compradores, então o
Server Component chama a função com `createSupabaseAdminClient()` somente após
`requireTabAccess("expedicao")`.

## Correção do sincronizador Shopee

A Shopee pode dividir o mesmo item/modelo em duas linhas promocionais dentro do
pedido. A chave histórica de `shopee_order_items` não inclui `line_item_id`; o
upsert recebia duas linhas com a mesma chave, o Postgres abortava o lote e
`upsertPackages()` não chegava a executar.

`shopee-sync` v16 colapsa apenas essas colisões, soma as quantidades e preserva
as linhas originais em `raw_json.oraculo_source_lines`. A frequência não foi
reduzida para 30 minutos: os quatro jobs já rodam escalonados a cada **15
minutos**, portanto entregam dado mais atual que o solicitado.

## Reparo e validação

- dois pedidos Dona Cor de 21/08 foram reparados: 7 unidades, 2 pacotes e 2
  rastreios;
- cobertura desde a ativação do funil: **52.679 pedidos pagos, zero sem pacote,
  100,0000%**;
- quatro lojas concluíram ciclos após o deploy com `status=success`, sem teto;
- RPC validada com os números auditados e execução medida em 1,32 s;
- typecheck e build de produção do Next.js concluídos.

Arquivos centrais:

- `apps/web/app/expedicao/page.tsx`;
- `supabase/functions/shopee-sync/index.ts`;
- `supabase/migrations/20260824194506_expedicao_vendas_pagas.sql`;
- `supabase/migrations/20260824195121_expedicao_vendas_service_role.sql`;
- `docs/fulfillment-pipeline.md`.
