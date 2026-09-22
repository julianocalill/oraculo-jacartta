# Status da Giracasa — 22/09/2026

## Operação ativada

A Giracasa está no ar desde 22/09/2026 às 17h27 (BRT), com `enabled=true` e as
sete pessoas ativas do Oráculo liberadas.

Abas liberadas: Home, Pedidos, Mais Vendidos, SKUs, Curva de Venda, Curva de
Estoque, Previsão de Vendas, Calculadora e Documentação.

Ficaram de fora, por não terem dado na operação: Importações, Logística,
Mercado Livre, Agenda, RPA, Full, Expedição, Reconciliação, Inteligência,
Devoluções, Shopee e Análise Comercial. Entram conforme as fontes forem
ligadas. Os dois administradores fixos do código enxergam todas as abas.

## O que sustenta a ativação

| Item | Estado |
| --- | --- |
| Motor | `gira-casa-v2` (ADR-009), margem 7,37% na janela conferida |
| Dados | 12.663 notas e 14.243 pedidos recuperados de 08 a 22/09 |
| Últimos 14 dias | Margem 7,19%, lucro R$ 37.112,83 |
| Cobertura | Item 98,4%, custo 85,5% |
| Crons | 11 jobs `giracasa-*` ativos |
| Acesso | Validado lendo como usuário autenticado, sem vazamento entre operações |

## Crons ativos

| Job | Horário | O que faz |
| --- | --- | --- |
| `giracasa-olist-invoices-30m` | :19 e :49 | Notas fiscais; também mantém o token da Olist vivo |
| `giracasa-olist-orders-hourly` | :29 | Pedidos |
| `giracasa-olist-derived-hourly` | :27 | Itens de pedido, vendas diárias, caches de canal |
| `giracasa-olist-stock-30m` | :07 e :37 | Estoque por produto |
| `giracasa-olist-products-daily` | 04h33 BRT | Catálogo e snapshot de estoque |
| `giracasa-olist-order-items-backfill` | 01h–05h BRT, :39 | Itens de pedido em atraso |
| `giracasa-fiscal-order-links-hourly` | :59 | Vínculo NF → pedido |
| `giracasa-olist-qty-cache-hourly` | :39 | Cobertura de pedidos por canal |
| `giracasa-nf-cache-hourly` | :31 | Cache de NF |
| `giracasa-unified-sku-cache-daily` | 03h21 BRT | SKUs unificados |
| `giracasa-shopee-token-refresh` | :09 | Token da Shopee |

O invocador dos jobs é `giracasa.invoke_olist_function`, criado dentro do
schema da operação para não alterar função de schema compartilhado. Ele não é
concedido a `authenticated`.

## Pendências

1. **Apuração de agosto do escritório**, para comparar com o Oráculo. Continua
   sendo a única validação externa que falta; o motor só foi conferido contra
   as regras do contador, não contra a contabilidade.
2. **471 NFs de pedidos cancelados** (R$ 32.851,81) sem decisão.
3. **Tarifas de TikTok e Mercado Livre**: 19% da receita aparece sem lucro
   calculável, como o contrato exige enquanto a tarifa não existir.
4. **Cadastro de SKUs**: 33 ausentes do catálogo e 15 duplicados.
5. **Loja Shopee Vari Útil** sem autorização; a carga Shopee segue no canário
   de 87 pedidos.
6. O estoque foi carregado em 08/09 e está sendo atualizado pelo cron novo;
   conferir a Curva de Estoque depois que a varredura completar.

## Reversão

```sql
update public.oraculo_operations set enabled = false where id = 'giracasa';
```

Isso tira a operação do ar sem apagar dado nem remover acesso.
