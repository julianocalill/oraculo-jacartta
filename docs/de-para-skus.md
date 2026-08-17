# De-para de SKUs — anúncio do marketplace → SKU Olist

**Entrega:** 2026-08-16 · **Onde:** botão "De-para de SKUs (.xlsx)" na aba `/skus`

## O problema

Cada anúncio no marketplace tem um SKU próprio (o do anúncio/variação); a baixa
de estoque acontece no SKU do **cadastro da Olist**. Sem o de-para em planilha,
a operação não sabe qual produto do ERP é debitado quando um anúncio vende.

A Olist tem esse vínculo internamente ("vínculo de anúncios"), mas a **API
pública Tiny v3 não o expõe** — verificado no swagger em 2026-08-16: só existe
`PUT /anuncios/{idMapeamento}/preco`, sem GET de listagem, e o item do pedido
(`ItemPedidoResponseModel`) só traz `produto` (cadastro), `quantidade`,
`valorUnitario` e `infoAdicional`.

## A solução: derivar por evidência de venda

O mesmo pedido existe dos dois lados do banco:

- lado canal: `shopee_order_items` (SKU do anúncio), `mercadolivre_order_items`
  (MLB + variação; criada nesta entrega), devoluções importadas para o TikTok;
- lado Olist: `oraculo_olist_order_ref_cache` (NF de venda → nº do pedido do
  canal) + `olist_invoice_items` (SKU Olist).

Casando pelo `numeroPedidoEcommerce` e usando **só pedidos inequívocos**
(exatamente 1 SKU distinto de cada lado — precedente da view
`oraculo_returns_reconciled`, onde 97,6% das NFs casadas têm SKU único), cada
par (anúncio → SKU Olist) acumula evidência. Regras:

- `mapeado` = ≥2 pedidos co-ocorrentes e ≥80% de dominância do par;
- `ambiguo` = evidência insuficiente ou anúncio que já apontou para mais de um
  SKU Olist (o "vice" fica registrado com `pair_rank=2`);
- `sem_casamento` = anúncio do catálogo sem nenhum pedido casado.

A **razão de quantidade** (`qty_ratio` = qtde Olist / qtde canal) denuncia
anúncios de fardo/kit: `CABIDE VELUDO-50UN` sai com razão 50 — o anúncio vende
1 fardo e a Olist baixa 50 unidades do SKU unitário. `olist_is_kit` marca
quando o SKU Olist é kit (`olist_products.tipo='K'`).

## Peças

| Peça | Arquivo |
|---|---|
| Cache + refresh | `supabase/migrations/20260816121000_create_sku_channel_map.sql` (`oraculo_sku_channel_map_cache`, `refresh_oraculo_sku_channel_map(p_force)`) |
| Itens de pedido ML | `supabase/migrations/20260816120000_create_mercadolivre_order_items.sql` + upsert no `mercadolivre-sync` |
| Rota de export | `apps/web/app/skus/de-para/export/route.ts` (4 abas: Shopee, Mercado Livre, TikTok, Não mapeados e ambíguos) |
| Botão | `apps/web/app/skus/page.tsx` (topbar) |

## Decisões

- **Refresh on-demand com throttle de 6h, sem cron.** Os worker slots do
  pg_cron estão no limite (migration `20260805190000`). O refresh roda dentro
  da própria rota de export: quem consome é quem atualiza, então o cache não
  congela silenciosamente; o `refreshed_at` sai impresso na planilha. Se o
  refresh falhar, a rota exporta o cache existente (planilha de ontem > erro 500).
- **Zero detoast de payload.** O lado Olist inteiro vem do cache estreito
  `oraculo_olist_order_ref_cache` (extrair `ecommerce` ao vivo custa ~64s/mês).
- **TikTok via devoluções.** A integração direta do TikTok
  (`tiktok_order_items`) existe no repo mas nunca foi aplicada em produção; a
  única fonte com (pedido, SKU do canal) são as devoluções importadas (1.694
  linhas com SKU). Amostra enviesada para pedidos devolvidos, mas o vínculo
  anúncio→produto é o mesmo. A razão de quantidade fica **nula** neste canal
  (a qtde da devolução não é a do pedido).
- **Mercado Livre por anúncio, não por SKU.** Só ~20 de 1.930 anúncios ML têm
  SKU preenchido; o de-para sai por (MLB + variação) → SKU Olist, com o SKU do
  seller quando existir. O `numeroPedidoEcommerce` do ML pode ser o order id
  **ou** o pack id (carrinho) — o match tenta os dois.
- **Não traduzir SKU por igualdade de string.** Só 19% dos SKUs de canal batem
  com o da Olist por texto (medição da migration `20260804120000`) — e quando
  batem, o de-para é identidade. A coluna `evidence` permite adicionar essa
  segunda passada depois sem mudar o schema.
- **`olist_products` tem SKU duplicado** (cadastros repetidos): o join do
  refresh deduplica por SKU (`min(nome)`, `bool_or(tipo='K')`) para não fanar
  linhas e estourar a PK do cache.
