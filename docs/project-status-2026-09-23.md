# Estado do projeto — 23/09/2026

## Fechamento oficial da Separação às 07:00

A execução agendada do n8n `96976` falhou às 07:00 BRT no nó **Hidratar
pedidos sem itens do fechamento**. A Edge Function `olist-sync-orders` devolveu
HTTP 500 com a mensagem genérica `[object Object]`; a causa interna não ficou
identificável nessa resposta. A lista oficial
`aec3637a-5ad0-4790-bae0-fe5c77af4911` permaneceu `pending` e o cursor
não avançou nesse momento.

Na verificação das 07:20, a RPC `logistica_picking_missing_order_ids` retornou
zero pedidos faltantes e uma chamada direta ao modo `hydrate_missing_picking`
da Edge Function respondeu 200, com `hydrated = 0` e `remaining = 0`. A lista
pendente foi retomada pelo webhook idempotente. O documento ficou `ready` às
07:21:45, com 1.196 pedidos, zero sem itens, 90 linhas, 5.215 unidades físicas,
115 caixas e 3.533 unidades avulsas. O cursor avançou no mesmo instante da
persistência até `2026-09-23T10:21:28.094Z`; o WhatsApp foi confirmado às
07:23:17, depois da persistência.

## Conferência da lista

- As 90 linhas persistidas conferem com o consolidado n8n em SKU/produto,
  quantidade, caixas e avulsos. Duas linhas sem SKU foram comparadas também
  pelo nome do produto, para não fundi-las durante a auditoria.
- Todas têm quantidade positiva; 71 têm zero caixas e seguem visíveis. As
  posições persistidas estão em ordem decrescente de caixas.
- O CSV do consolidado tem 90 linhas. A impressão A4 e a rota CSV do Oráculo
  usam `loadPickingList`, que lê essas mesmas linhas por `position`.
- O cadastro canônico Olist indica `213849`: 28 kits × 2 de `213169` = 56
  pacotes; `213969`: 30 kits × 10 de `213877` = 300 potes. Ambos os componentes
  aparecem consolidados e nenhum desses SKUs de kit aparece como linha física.
  Ao todo, 73 SKUs comerciais de kit foram encontrados nas origens expandidas,
  sem permanecer como SKU na lista.
- O envio teve uma execução bem-sucedida: cinco partes de texto e um CSV, com
  uma confirmação de WhatsApp. `whatsapp_status = sent`.

O erro 500 original não teve causa raiz confirmada. Se reaparecer, consultar
primeiro a RPC de pedidos sem itens e a resposta da Edge Function antes de
retomar; conferir `whatsapp_status` e o cursor para evitar reenvio. O
acompanhamento automático pontual foi pausado após esta validação.
