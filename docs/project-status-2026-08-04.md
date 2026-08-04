# Estado do projeto — 2026-08-04

Supersede `docs/project-status-2026-07-17.md`. O que mudou desde então: a aba
**Devoluções** (nova área de produto, três canais) e a **margem fiscal com
comissão de marketplace**.

## Devoluções — nova área de produto

### O que existe

Uma camada canônica única, `oraculo_returns`, alimentada por três fontes
distintas, e uma tela (`/devolucoes`) que lê **só** dela. Trocar a fonte de um
canal não mexe na UI.

| canal | fonte | cadência |
|---|---|---|
| Shopee | `shopee-returns-sync` (API) | cron **por loja**, a cada 2h (`:12` `:24` `:36` `:48`) |
| Mercado Livre | `mercadolivre-returns-sync` (API) | cron horário `:35` |
| TikTok | upload de .xlsx na própria tela | manual |

PK `(channel, return_id)` — reimportar ou reprocessar **atualiza**, nunca
duplica.

### O cruzamento com a nota fiscal

É o que nenhum painel de marketplace faz, e o motivo de a aba existir. Dois
saltos:

```
devolução do canal --[order_ref = ecommerce.numeroPedidoEcommerce]--> NF de VENDA
                                                                       |
                                               [client_document + SKU + 90 dias]
                                                                       v
                                                             NF de DEVOLUÇÃO
```

O salto 1 é **exato** (testado 6/6 na primeira carga). O salto 2 é
**heurístico**, porque a NF de devolução tem `order_id`/`order_number` zerados e
bloco `ecommerce` vazio — não existe chave direta. Daí o `match_score`
(`exato` / `provavel` / `sem_match`).

### Números de julho/2026

| canal | devoluções | estornado |
|---|---|---|
| Shopee (4 lojas) | 3.358 | R$ 223.602 |
| TikTok (3 lojas) | 1.725 | R$ 82.669 |
| Mercado Livre | 4 | — (a API não devolveu valor) |

Funil consolidado — **os quatro estágios de decisão somam o topo**:

```
3.196 abertas  =  464 aguardando + 523 canceladas + 650 recusadas + 1.559 concedidas
```

Cruzamento das que contam como perda: 1.359 conferem · **892 sem NF de
devolução** · 612 sem NF de venda · 269 divergência de quantidade · 67 de valor.

### Objetos de banco

- `oraculo_returns` (canônica) · `oraculo_return_reason_map` (de-para como
  **dado**) · `oraculo_returns_upload_batches`
- `oraculo_olist_devolucoes` (view) · `oraculo_returns_reconciled` (view)
- `oraculo_olist_order_ref_cache` + `_days` (controle) — cron `:07`/`:37`
- RPCs: `oraculo_returns_funnel`, `_summary`, `_by_reason`, `_by_sku`, `_disputes`

Migrations `20260803120000`, `20260804120000`, `_150000`, `_170000`, `_190000`,
`_200000`, `_210000`.

## Armadilhas medidas (as que custariam caro)

- **Filtro de devolução é `fiscal_origin_type='devolucao'`, nunca
  `fiscal_invoice_type='E'`.** O tipo arrasta compra e importação: em julho a
  origem dá R$ 296 mil, o tipo dá R$ 5,58 mi — **18x** de inflação.
- **A Shopee limita `create_time` a 15 dias.** Pedir 16 devolve `error_param` e a
  janela inteira volta **vazia sem falhar o processo** — o dado some em silêncio.
  A função quebra qualquer intervalo em blocos de 14 dias.
- **4 lojas Shopee numa invocação estouram o teto da edge function.** O primeiro
  backfill morreu no meio, sem log, deixando uma loja de fora e outra parada em
  23/07. Mesma causa do `shopee-sync-products`; mesma solução: cron por loja.
- **O `/claims/search` do ML ignora filtro de data e ordenação.**
  `date_created_from`, `date_created_to` e `sort` retornam HTTP 200 e não têm
  efeito. Só `offset` funciona, e a API exige ao menos um filtro (`stage`/`type`)
  senão devolve 400. A função pagina de trás para frente e filtra do nosso lado.
- **Cache que infere "dia processado" pela existência de linhas trava em dia
  vazio.** Maio/2026 não tem NF (a base começa em junho), então o dia nunca
  ficava coberto e o laço girava em falso: 62 dias processados, 0 linhas. O cron
  travaria igual, do jeito mais caro — rodando, sem erro, sem avançar. Corrigido
  com tabela de controle de dias.
- **`Refund rejected` não é perda** — 37% das linhas do TikTok. Contá-las infla a
  devolução em ~60%. `refund_only` também não gera NF de devolução: sem separar,
  o cruzamento acusa centenas de falsos "sem NF".
- **O SKU do canal casa com o da NF em só 19% dos casos** (21 de 108 no TikTok) —
  mesma armadilha de nomenclatura já conhecida da Shopee. O SKU Olist vem da
  **NF de venda já casada**, que em 97,6% dos casos tem SKU único.
- **Valor compara contra `olist_invoices.total_amount`, não
  `olist_invoice_items.total_value`** (que traz o preço cheio do item). A mediana
  da razão dava exatamente 2,003 — assinatura de erro sistemático. Falsos
  positivos de divergência: 327 → 25.
- **Funil que não fecha é funil enganoso.** Faltava o estágio `cancelada` (523
  casos): 16% do topo sumindo sem explicação.

## Margem fiscal com comissão de marketplace

Ver `CHANGELOG.md` (entradas de 2026-08-04) e `docs/fiscal-financeiro-port.md`.
Em resumo: a margem deixou de ser só tributária; comissão entra por faixa como
**dado editável** (`oraculo_marketplace_fee_params`), escolhida pelo preço
**unitário**. Efeito medido em 01/08: margem 32,3% → 5,3%. Não é piora do
negócio — é o número que faltava. `/parametros` passou a dirigir as alíquotas de
ICMS de verdade.

## Pendências conhecidas

1. **ML não traz valor de reembolso** — o endpoint de detalhe não devolveu o
   campo nos casos existentes. Com 4 casos não move o total; se o canal crescer,
   precisa ser resolvido.
2. **`refreshed_at` das rotinas de devolução não está em `/status`** — a regra do
   repositório pede, e ainda não foi feito.
3. **Alertas de devolução** (SKU acima de X% com volume relevante; devolução sem
   NF há mais de N dias) não existem; o parâmetro caberia em `/parametros`.
4. **"Sem NF de venda" (612 casos)** é limitação de lastro, não furo: a base de
   NFs da Olist começa em junho/2026. Fechar exige puxar NFs anteriores.
5. **O casamento da NF de devolução é heurístico** — conferir uma amostra antes
   de tratar os 892 "sem NF" como verdade operacional.

## Deploy

- Produção: `https://oraculo.oliverhome.com.br`
- **Dois remotes git**: `origin` = `Grupo-Jacartta/oraculo`;
  `personal` = `julianocalill/oraculo-jacartta`. **A Vercel escuta o
  `personal`** — push só no `origin` não publica nada. E esse repositório é
  público.
