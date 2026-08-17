# Funil de expedição Shopee × Bip

## Objetivo

Conciliar, por pacote e `tracking_number`, quatro marcos independentes:

1. pacote que a Shopee informa como necessário para envio;
2. etiqueta bipada pelo Comercial no Bip;
3. pacote recebido pela Logística interna no Bip;
4. coleta confirmada pela Shopee.

Contagens de pedidos não são usadas como chave: um pedido pode ter mais de um
pacote. Cancelamentos e pedidos não pagos ficam fora da carga operacional.

## Fronteiras e fontes de verdade

- Shopee: `shopee-sync`, no Oráculo, coleta os dados logísticos usando o token
  replicado. O único renovador dos tokens rotativos é o workflow n8n
  `Zeptn7GL4bOOsGKj`.
- Bip Comercial: `printed_label_audits` no banco do Bip.
- Bip Logística: `logistics_label_receipts` no banco do Bip.
- Conciliação e histórico gerencial: banco do Oráculo.
- TVs operacionais: aplicação do Bip, consumindo um endpoint agregado do
  Oráculo pelo próprio backend.

O Bip e o Oráculo usam bancos Supabase diferentes. Não há acesso direto do
navegador a service role e nenhum bip faz dual-write síncrono: falha no Oráculo
não pode bloquear o scanner.

Nas TVs, **carga do dia** significa os pacotes com prazo no dia mais qualquer
backlog anterior ainda sem coleta. Pacotes antigos já coletados não inflam a
meta atual. Na aba estratégica, o filtro continua agrupando pelo dia de envio.

## Shopee: contrato validado em 2026-08-09

`order/get_order_detail`, com `package_list,ship_by_date,shipping_carrier`,
retorna um pacote com `package_number`, `logistics_status` e transportadora.
O rastreio vem de `logistics/get_tracking_number`, com `order_sn` e
`package_number`.

Observado em amostra real das quatro lojas:

- `LOGISTICS_READY`: pacote ainda sem rastreio disponível;
- `LOGISTICS_PICKUP_DONE`: coleta bipada/confirmada;
- `LOGISTICS_DELIVERY_DONE`: entrega concluída, portanto a coleta ocorreu.

`carrier_collected_at` é a primeira observação do status pelo Oráculo, não o
timestamp exato do scanner da transportadora. A UI deve chamar esse campo de
"confirmação detectada" quando precisão de minuto for relevante.

## Objetos

- `shopee_fulfillment_packages`: uma linha por pacote Shopee.
- `bip_fulfillment_events`: espelho idempotente por marketplace + código.
- `bip_fulfillment_sync_runs`: saúde do espelho incremental.
- `oraculo_fulfillment_pipeline`: view do estado atual conciliado.
- `oraculo_fulfillment_summary`: totais e tempos do período.
- `oraculo_fulfillment_daily`: série por dia de envio.
- `oraculo_fulfillment_by_shop`: conversão por loja.

Estados calculados:

- `awaiting_tracking`
- `pending_commercial`
- `between_departments`
- `waiting_carrier`
- `carrier_collected`
- `divergence_logistics_without_commercial`
- `divergence_carrier_without_logistics`
- `cancelled`

## Sincronização entre sistemas

O Bip expõe `GET /internal/oraculo/fulfillment-events`, protegido por
`x-integration-secret`. A Edge Function `bip-fulfillment-sync` lê alterações
recentes com sobreposição de 10 minutos e faz upsert no espelho. O cron roda a
cada dois minutos.

Os quatro jobs incrementais da Shopee rodam a cada 15 minutos, escalonados. A
Jacartta usa o minuto 9 do ciclo.

Variáveis no Bip:

- `ORACULO_FULFILLMENT_EXPORT_SECRET`
- `ORACULO_FULFILLMENT_DASHBOARD_URL`
- `ORACULO_FULFILLMENT_DASHBOARD_SECRET`

Variáveis nas Edge Functions do Oráculo:

- `BIP_FULFILLMENT_EXPORT_URL`
- `BIP_FULFILLMENT_EXPORT_SECRET`
- `SHOPEE_SYNC_SECRET` (já existente; reutilizado pelo cron interno)
- `FULFILLMENT_DASHBOARD_SECRET`

Vault do Oráculo:

- `oraculo_shopee_sync_job_secret` (já existente)

Valores reais nunca entram no repositório, Obsidian ou logs.

## Interfaces

- Bip: `/production-board.html?setor=comercial`
- Bip: `/production-board.html?setor=logistica`
- Oráculo: `/expedicao`
- Saúde: `/status`, linha `Expedição · espelho do Bip`

As TVs precisam de uma sessão válida do Bip. O navegador fala apenas com
`/api/production-board`; o segredo do Oráculo fica no backend.

## Ativação em produção

Não ativar parcialmente. Ordem segura:

1. aplicar migrations `20260809180000` e `20260809181000` no Oráculo;
2. configurar os segredos do Bip e das Edge Functions;
3. publicar `shopee-sync`, `bip-fulfillment-sync` e `fulfillment-dashboard`;
4. publicar o Bip e testar o export interno com segredo inválido/válido;
5. executar `shopee-sync` em janela curta por loja;
6. executar `bip-fulfillment-sync` manualmente e conferir a view;
7. validar `/expedicao`, as duas TVs e `/status`;
8. só então deixar o cron de dois minutos ativo.

Depois do deploy, liberar a aba **Expedição** para os gestores na matriz de
acessos de `/usuarios`. Administradores fixos já recebem a nova aba
automaticamente.

## Rollback

- Desativar `oraculo-bip-fulfillment-2m` interrompe o espelho sem afetar bipes.
- Reverter o frontend remove as telas sem apagar dados.
- O `shopee-sync` continua salvando pedidos mesmo se a consulta de rastreio
  individual falhar.
- Não apagar as tabelas para rollback; elas são aditivas e não alteram os
  registros originais do Bip ou da Shopee.
