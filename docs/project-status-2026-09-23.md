# Estado do projeto — 23/09/2026

## Expedição atualizada e protegida contra zeros falsos

- A janela padrão de sete dias de `/expedicao` estourava o `statement_timeout`
  do PostgREST em cache frio. A UI recebia erro da RPC de vendas, reduzia a
  resposta vazia e mostrava zero pedidos/unidades apesar de o funil e os syncs
  estarem saudáveis.
- A RPC `oraculo_fulfillment_sales_daily` ganhou índices de cobertura para
  pedidos pagos, quantidade dos itens e pacotes por pedido. Na validação após a
  migration, a mesma janela respondeu dentro do limite também em paralelo com
  as demais consultas da página.
- A interface não transforma mais erro de vendas em zero: apresenta `—` e uma
  mensagem específica, preservando o restante do funil operacional.
- As quatro lojas Shopee e o espelho do Bip foram atualizados. Em 17–23/09 a
  leitura final registrou 8.469 pedidos pagos, 8.966 unidades e 8.469 pacotes
  dessas vendas, sem pedido sem pacote. A carga por prazo somou 8.258 pacotes;
  os blocos diferem por contrato porque usam datas distintas (pagamento versus
  prazo de envio).
- A auditoria confirmou 183.470 pacotes, uma linha no pipeline por pacote,
  nenhum rastreio duplicado e nenhum código do Bip duplicado.

## Comissão opcional de afiliado na calculadora

- Os presets Shopee e TikTok de `/calculadora` ganharam um campo opcional de
  comissão de afiliado. O campo sempre começa vazio, é limpo ao trocar de
  marketplace ou restaurar os padrões e, vazio, equivale a 0%.
- Quando preenchido, o percentual incide sobre o preço de venda, aparece na
  decomposição de custos e também participa da busca do menor preço por margem
  líquida. Mercado Livre permanece sem esse campo.
- Sem alteração no motor fiscal, no banco ou nos presets de comissão dos canais.

## Preços para colaboradores em Pessoas

- Nova aba `/precos-colaboradores` no setor Pessoas, com acesso governado pela
  matriz de abas de `/usuarios` e busca por nome ou código.
- A carga congelada veio de `PREÇO PARA COLABORADORES 1.xlsx`: 254 linhas, 253
  códigos únicos e nenhum item sem descrição ou preço final. A interface não
  publica custo nem fórmula da planilha.
- O código `214858` aparece duas vezes na origem, com o mesmo produto e preços
  de R$ 49,44 e R$ 52,48. As duas linhas foram preservadas e recebem um aviso
  de duplicidade até a área responsável confirmar qual deve permanecer.
- `apps/web/scripts/import-employee-prices.mjs` valida os cabeçalhos e regenera
  o catálogo tipado para futuras atualizações da planilha.

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
