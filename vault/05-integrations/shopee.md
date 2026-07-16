# Shopee

Status: **canal completo** — pedidos + escrow (take rate) desde 2026-07-13;
analítica de estoque/FBS e sugestão de reposição desde 2026-07-16.

## Lojas (4, cada uma com seu próprio partner app)

| Loja | shop_id | FBS |
|---|---|---|
| Jacartta | 279375549 | inscrita, sem estoque em CD |
| Espaço De Bicho | 823664460 | inscrita, sem estoque em CD |
| Donacor | 1227023039 | inscrita, sem estoque em CD |
| Oliverhome | 1540426526 | **ativa** — estoque em armazéns Shopee |

Todas vinculadas aos 7 armazéns BR (SP/MG/GO/PE/RS/RC + BRS).
Atenção: **cada loja tem partner_id/partner_key próprios** — toda chamada à
API assina com a chave da loja (erro `invalid_access_token` costuma ser
assinatura com a chave errada, não token vencido).

## Sincronizações

- `shopee-sync` (15 min/loja): pedidos + itens; **renovador único** do token
  (refresh rotativo — nenhuma outra função renova).
- `shopee-escrow-sync` (30 min/loja): comissão/taxas/líquido por pedido.
- `shopee-sync-sbs` (horário, :42): inventário FBS por SKU × armazém via
  `/api/v2/sbs/get_current_inventory` — a Shopee entrega vendável/reservado,
  trânsito, cobertura, velocidade e janelas 7–90d prontos. Snapshot diário.
- `shopee-sync-products` (6h, POR LOJA escalonado — as 4 juntas estouram o
  teto da edge function): anúncios + modelos/variações + estoque local
  (`get_item_list` → `get_item_base_info` → `get_model_list`); snapshot
  diário; ao final recalcula `shopee_sales_daily` (derivada dos pedidos) e
  agregados 30/60d dos produtos (RPCs).

## Produto — três abas em `/shopee`

- **Take Rate** (2026-07-13): comissão e ROI líquido por loja/SKU via escrow.
- **Estoque & FBS**: ruptura FBS por armazém (perda R$/dia com a velocidade
  da própria Shopee), cobertura FBS, ruptura/parado do estoque local, Curva
  ABC 80/15/5 por loja, tendência 120→0, filtro por loja.
- **Sugestão de reposição**: `repor = média/dia × (alvo + prazo) − estoque −
  trânsito`; FBS usa selling_speed da Shopee e limita ao estoque local
  disponível para envio; justificativa por item; **máx. 15 itens por loja**
  (regra de produto).

## Fatos de dados (primeira carga 2026-07-16)

- 3.747 produtos/modelos, **98% com SKU** (disciplina muito melhor que o ML).
- 616 produtos com venda 30d; diagnóstico inicial: 76 rupturas locais
  (≈ R$ 12,9k/dia) + 8 SKUs zerados no FBS da Oliverhome.
- Pedidos desde 31/05 (~46 mil) — tendência 120d fica completa com o tempo.
- Custo Olist casa pouco ainda (SKUs de lojas ≠ catálogo Olist).

## Referências

- `docs/deployment-map.md` (funções e crons) · `CHANGELOG.md` 2026-07-16
- Módulos SBS/FBS da Open Platform: get_current_inventory, get_bound_whs_info,
  get_stock_aging, query_br_shop_enrollment_status (docs espelhadas no GitHub;
  open.shopee.com bloqueia scraping)
- [[mercadolivre]] — canal irmão; [[olist]]; [[../07-decisions/decision-log]]
