# Plano de ação — aba "Devoluções"

Status: **Fases 1 a 6 entregues** (2026-08-04) — camada canônica, lado Olist,
upload do TikTok, UI com funil, Shopee por API e Mercado Livre por API estão em
produção. **Pendente só a fase 7** (alertas de devolução em `/parametros` e o
`refreshed_at` das rotinas em `/status`).
Estado atual e armadilhas: `docs/project-status-2026-08-04.md`.

## Objetivo

Uma aba `/devolucoes` no Oráculo que responda, por canal, período e SKU:

- quanto foi devolvido (unidades e R$) e qual a **taxa de devolução**;
- **por que** foi devolvido (motivo), e qual o impacto financeiro;
- quais SKUs concentram devolução;
- **onde a devolução do canal e a NF de devolução da Olist não batem** — o
  cruzamento é entregável de primeira classe, não um extra.

Fontes: **Shopee e Mercado Livre via API**; **TikTok via upload de Excel**;
**Olist (NF de devolução) via dados que já estão no banco**.

## Decisões travadas

1. **Janela**: a partir de **2026-07-01**. Sem backfill anterior.
2. **Perda**: o produto deve ter voltado com **NF de devolução baixada na Olist**.
   O cruzamento canal × Olist é o detector de inconsistência (ver abaixo).
3. **Upload**: apenas **TikTok** (3 lojas: Donacor, Aliver, Jacartta).
4. **Ingestão**: upload direto na própria página `/devolucoes`.

## Achados da investigação (validados contra a produção)

Isto muda o desenho — foi tudo medido, não presumido.

### A NF de devolução já está no banco, e está sendo filtrada de propósito

`olist_invoices` tem `fiscal_invoice_type` e `fiscal_origin_type` materializados,
e `oraculo_fiscal_invoices_valid` **exclui** `tipo='E'` / `origem.tipo='devolucao'`
(migração `20260622180146`). Não precisamos de sync novo para o lado Olist — só
parar de descartar.

**Armadilha crítica de filtro** — julho/2026:

| filtro | NFs | R$ |
|---|---|---|
| `fiscal_origin_type = 'devolucao'` | **4.074** | **296.171,32** ✅ |
| `fiscal_invoice_type = 'E'` sem origem | 160 | 5.286.699,22 ❌ compras/importação |

Filtrar por `tipo='E'` infla a devolução em **18x** (R$ 5,58 mi contra R$ 296 mil
reais). **O filtro é `fiscal_origin_type='devolucao'`, nunca o tipo da NF.**
R$ 296 mil sobre ~R$ 8,6 mi/mês ≈ **3,4%** — ordem de grandeza plausível.

### A NF de devolução não carrega o pedido do marketplace

Nas 4.074 NFs de devolução de julho: `order_id` e `order_number` **zerados**
(0/4.074), bloco `ecommerce` vazio (por isso caem em "Sem canal"), e
`origem.id` é um id interno da Olist (ex.: `24152`), não o pedido do canal.
Têm `client_document` (4.074/4.074) e itens (3.959/4.074 = 97%).

### O caminho de reconciliação — 2 saltos, validado

A NF de **venda** carrega `ecommerce.numeroPedidoEcommerce`, que **é** o id nativo
do pedido no canal (129.095 de 129.129 NFs de julho preenchidas):

| canal na Olist | exemplo | NFs jul |
|---|---|---|
| Shopee Jacartta / toca / … | `260701GPKDRHUX` | 19.445 / 16.922 |
| TikTok Shop Jacartta / Oliver / Toca | `584632430446806301` | 4.038 / 3.529 / 327 |
| Mercado Livre (+ Fulfillment) | `2000013534987365` | 1.411 / 2.504 |
| Amazon | `701-0136839-7389062` | 549 |
| Shein | `GSH18103F002272` | 220 |

**Teste real**: os 6 primeiros `Order ID` da planilha do TikTok casaram
**6/6** com NF de venda por esse campo.

Então:

```
devolução do canal --[Order ID = ecommerce.numeroPedidoEcommerce]--> NF de VENDA
                                                                      |
                                              [client_document + SKU + data >=]
                                                                      v
                                                            NF de DEVOLUÇÃO (Olist)
```

O salto 1 é exato. O salto 2 é **heurístico** (CPF + SKU + janela de data), porque
a NF de devolução não guarda referência à venda. Score de confiança por match:
`exato` (CPF+SKU+valor) / `provável` (CPF+SKU) / `sem match`.

### A planilha do TikTok é heterogênea

`Pedidos de devolução_reembolso-2026-07-26.xlsx` — **1.728 linhas, 3 abas
(uma por loja), todas de julho/2026, `Return Order ID` 100% único**.

- **Abas com layouts diferentes**: `tiktok Donacor` tem 19 colunas; `aliver` e
  `jacartta`, 25 — faltam em Donacor `Return Quantity`, `Return Sub Status`,
  `Refund Time`, `Compensation Status/Amount`. **O parser mapeia por nome de
  cabeçalho, nunca por posição**, e trata coluna ausente como nula.
- **Tipos sujos na mesma coluna**: `Return unit price` vem `234.9` (número) numa
  aba e `"R$ 62,90"` (texto) noutra. `Return Quantity` vem `"1"` texto. Parser
  normaliza pt-BR → numeric.
- Sem `Return Quantity` na Donacor → assume 1 e marca `qty_assumida = true`
  (não inventar em silêncio).
- Aba vazia `Planilha3` é ignorada.
- Datas em `dd/MM/yyyy HH:mm:ss`, America/Sao_Paulo.
- O nome da loja vem **do nome da aba**, não de coluna.

De-para dos 12 `Return Reason` reais para 8 buckets:

| TikTok | `reason_group` |
|---|---|
| Defective item (531) · Item arrived damaged (473) · Package arrived damaged (133) | `produto_com_defeito` / `avaria_transporte` |
| Package wasn't received (264) · Delivery couldn't be completed (1) | `nao_recebido` |
| Item doesn't match description (101) | `divergencia_anuncio` |
| No longer needed (82) | `arrependimento` |
| Wrong item was sent (68) · Package received but missing item (29) | `item_errado` |
| Product wouldn't arrive on time (32) · Item arrived too late (7) | `atraso` |
| Congrats on meeting your refundable sample criteria! (7) | `outros` |

**`Return Status` decide se conta**: `Completed` (767) e `In Process` (207)
contam; **`Refund rejected` (635) não é perda** — 37% das linhas. Somar tudo
inflaria a devolução em ~60%. `To Process` (119) entra como pendente.
`Return Type`: `Refund only` (474) **não gera NF de devolução na Olist** — o
produto não volta; separar de `Return and refund` (1.254) senão o cruzamento
acusa 474 falsos "sem NF".

### TikTok não tem API viva hoje

A migração `20260728120000_create_tiktok_shop_integration.sql` existe mas
`tiktok_orders` **não existe na produção** — não foi aplicada. Ou seja: hoje o
upload não é só uma escolha, é o único caminho. Aplicar a integração TikTok e
migrar devolução para API fica como fase futura.

## Arquitetura

```
 [shopee-returns-sync]  [ml-returns-sync]  [upload .xlsx TikTok]   [olist_invoices]
         |                     |                    |              (origem=devolucao)
   shopee_returns    mercadolivre_returns   oraculo_returns_upload         |
         \____________________ | ___________________/                      |
                               v                                           |
                    oraculo_returns (canônica)                             |
                               v                                           |
                 oraculo_returns_reconciled  <---------------------------- +
                    (match canal × NF de devolução + score + divergência)
                               v
                         /devolucoes
```

### `oraculo_returns` (canônica)

`channel` · `account_ref` (loja) · `return_id` · `order_ref` · `sku_channel` ·
`sku_olist` · `qty` (+ `qty_assumida`) · `opened_at` · `closed_at` · `status`
(`aberta`/`aceita`/`recusada`/`cancelada`) · `return_type` (`refund_only`/
`return_and_refund`) · `reason_raw` · `reason_group` · `refund_amount` ·
`order_amount` · `source` (`api`/`upload`) · `raw` (jsonb).

PK lógica `(channel, return_id)` → reimportar atualiza, não duplica.

### `oraculo_returns_reconciled` (view)

Para cada devolução: NF de venda casada, NF de devolução casada, `match_score`
(`exato`/`provavel`/`sem_match`), e `flag` de inconsistência:

- `sem_nf_devolucao` — canal aceitou devolução, produto não deu entrada na Olist.
- `nf_sem_devolucao_canal` — NF de entrada sem devolução correspondente no canal.
- `divergencia_valor` — diferença > 5% entre estorno e valor da NF.
- `divergencia_qtd` — quantidade devolvida ≠ quantidade da NF.

Essa view é o coração da aba: é o que vira dinheiro recuperado.

### Taxa de devolução — armadilha do denominador

Não usar `olist_order_items` (cobertura oscila) nem somar `source='olist'` +
`source='shopee'` (mesma venda duas vezes). Adotado:

- **denominador = NFs de venda por `ecommerce.nome`** — o mesmo campo que faz o
  salto 1. Fica consistente por construção com o numerador.
- devolução atribuída à **data do pedido**, não à data da devolução (senão o mês
  corrente parece sempre ótimo). A tela mostra as duas leituras, rotuladas.

## Fases

### Fase 1 — Fundação (1 migração)
`oraculo_returns`, `oraculo_return_reason_map` (de-para como dado, não código),
`oraculo_returns_upload_batches`, view `oraculo_returns_reconciled`, RPCs de
agregação. `grant select` **e** policy `for select to authenticated` em todas.
View de custo reusa `oraculo_sku_unit_cost` — **não** reimplementar custo.

### Fase 2 — Lado Olist (sem sync novo)
View `oraculo_olist_devolucoes` sobre `olist_invoices` com
`fiscal_origin_type='devolucao'` + itens, a partir de 2026-07-01. Índice em
`(fiscal_origin_type, emission_date)` e em `client_document`.

### Fase 3 — Upload TikTok
- Rota `/devolucoes/importar` na própria página: server action + ExcelJS
  (dependência já existente, zero lib nova).
- Parser por **nome de cabeçalho**, multi-aba, loja pelo nome da aba, tipos
  pt-BR normalizados.
- Lote transacional: valida tudo → grava `oraculo_returns_upload_batches`
  (arquivo, usuário, contagens) → upsert por `(channel, return_id)` → relatório
  de erros por linha. Nada grava pela metade.
- **Teste de aceite**: subir `Pedidos de devolução_reembolso-2026-07-26.xlsx` →
  1.728 linhas, 0 duplicadas, 3 lojas, 767 concluídas / 635 rejeitadas.

### Fase 4 — UI `/devolucoes`
- Link em `MAIN_LINKS` de `sidebar-nav.tsx`, após "Mercado Livre".
- `<AppShell alertCount={…}>`, server-rendered.
- `MetricCard` com sparkline: taxa de devolução %, unidades, R$ estornado,
  R$ sem NF de devolução (o número que gera ação), prazo médio.
- Donut SVG de `reason_group`; barras por canal; `sortable-table` de SKUs e uma
  **tabela de inconsistências** com filtro por `flag`. `hint` em toda coluna
  calculada, texto em `lib/column-hints.ts`.
- Área de upload visível na própria página. Export .xlsx reusando o builder da tela.
- `.table-wrap` para rolagem horizontal; `min-width: 0` respeitado.

### Fase 5 — Shopee via API
`shopee-returns-sync` com `get_return_list` + `get_return_detail`. **Lê o token,
nunca renova** (renovador exclusivo: workflow n8n `Zeptn7GL4bOOsGKj`); pula loja com TTL < 5 min;
assina com a partner key de cada uma das 4 lojas. Cron por loja a cada 30 min,
**agendado na mesma migração** (rotina sem cron é falha invisível — já custou 45 dias).

### Fase 6 — Mercado Livre via API
`mercadolivre-returns-sync` com `/post-purchase/v1/claims/search` +
`/claims/{id}/returns`. **Lê o token rotativo, nunca renova** (renovador
exclusivo: `mercadolivre-sync`). Cron horário em `:35`.

### Fase 7 — Alertas, status, docs
`refreshed_at` das rotinas em `/status`; alerta acionável para devolução sem NF
acima de N dias e para SKU com taxa acima do limite (parâmetro em `/parametros`);
`docs/project-status-2026-08-XX.md` + `CHANGELOG.md` + README apontando pro novo status.

## Ordem de execução

1 → 2 → 3 → 4 (aba viva com TikTok + cruzamento Olist, valor imediato) → 5 → 6 → 7.
