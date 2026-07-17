# Mercado Livre

Status: **canal analítico completo em produção** (conexão 2026-07-14;
analítica v2/v3 + sugestão de envio 2026-07-16).

## Conta

- Seller: `112538836` — JACARTTA ATACADOEVAREJO (site MLB)
- App Mercado Livre do Oráculo: `3371518680797281`
- OAuth PKCE validado por `/users/me`; tokens rotativos em tabela
  `service_role`-only; renovação exclusiva do `mercadolivre-sync`

## O que entra (somente leitura)

- Anúncios (1.930; 435 Full) e **variações** (574 em 96 anúncios, com
  atributos, preço e estoque Full por variação)
- Estoque físico Full por `inventory_id` (anúncio e variação)
- Pedidos pagos: histórico desde 2026-03-24 (~19,2k pedidos), séries diárias
  por anúncio (`mercadolivre_sales_daily`) e por variação
- Snapshots diários de estoque (base do cálculo de dias-com-estoque)
- Estoque em trânsito informado manualmente (`mercadolivre_transit`)

## Cadência

- `mercadolivre-sync` horário (`:55`) + RPC de agregados (janelas 30/60d)
- `mercadolivre-process-notifications` a cada 10 min (tópicos `items`/
  `items_prices` em quase tempo real; tópicos ativados no DevCenter)
- Limpeza semanal da inbox (dom 06:37 UTC, retenção 30d)
- Saúde em `/status`

## Produto — duas abas em `/mercado-livre`

**Visão geral**: ruptura em R$/dia (anúncios Full e locais + por variação,
velocidade calculada sobre dias-com-estoque), cobertura Full somando
trânsito, capital parado com ação sugerida (retirada/investigar/promoção),
Curva ABC 80/15/5, tendência 120→0, margem unitária via custo Olist
(`oraculo_product_effective_cost`), card "Saúde da Curva A".

**Sugestão de envio Full**: regra Magiic
`enviar = média/dia × (alvo + coleta) − Full − trânsito`, parâmetros
ajustáveis, justificativa detalhada por item (curva, velocidade com
tendência, situação, a conta do envio), prioriza ruptura → crítico →
abaixo do alvo → fora do Full; cards de venda protegida e perda estancada;
**máx. 15 itens por conta** e **export .xlsx** (mesma lógica da tela, via
`build-suggestions.ts`).

Cabeçalhos das colunas calculadas têm tooltip explicativo (`?`), com textos
em `apps/web/lib/column-hints.ts` — os mesmos usados na Shopee.

## Travas conhecidas

- **Margem**: só 20/1930 anúncios têm SKU preenchido no ML (0 variações) —
  preencher SKUs com os códigos do ERP destrava o cruzamento com o livro de
  custos (`oraculo_sku_unit_cost`, compartilhado com a Shopee).
- **Variações**: nenhum anúncio com variação vendeu em 60d; a seção fica
  vazia até esse perfil mudar (rastreamento contínuo).

## Referências

- `docs/mercadolivre-integration.md` (arquitetura/segurança/operação)
- `docs/project-status-2026-07-17.md` (estado atual)
- `docs/product/prd-mercadolivre-analytics.md` (tese de produto / estudo Magiic)
- [[olist]] — padrão de sync; [[../07-decisions/decision-log]]
