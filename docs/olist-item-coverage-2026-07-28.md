# Cobertura de itens do Olist e ranking por quantidade

Data do levantamento: 2026-07-28
Origem: construção da aba `/mais-vendidos` (ranking por quantidade)
Modo: leitura + correções aplicadas em produção

## Resumo executivo

A aba `/mais-vendidos` nasceu contando pedidos a partir de
`olist_order_items` e devolveu `1.989` pedidos em 3 dias, contra `~6.890`
contados manualmente na Olist. A investigação mostrou que o erro de leitura
expôs três problemas reais de dado, não um bug de tela:

1. `olist_order_items` cobre uma fração dos pedidos, e a fração varia por dia.
2. O importador de pedidos reescreve dias já passados, então cache de dia
   antigo não pode ser congelado no dia seguinte.
3. Um único pedido B2B sem canal distorce qualquer ranking por quantidade.

Todos os três estão tratados. Este documento registra os números medidos e as
regras que passaram a valer.

## 1. Cobertura de itens por dia

Contagem feita em `2026-07-28` sobre `oraculo_olist_qty_channel_daily_cache`
(pedidos válidos, cancelados fora):

| dia | pedidos | com itens | cobertura |
|---|---:|---:|---:|
| 2026-07-21 | 6.058 | 1.578 | 26,0% |
| 2026-07-22 | 5.965 | 1.565 | 26,2% |
| 2026-07-23 | 5.145 | 1.593 | 31,0% |
| 2026-07-24 | 3.773 | 1.546 | 41,0% |
| 2026-07-25 | 1.530 | 1.212 | 79,2% |
| 2026-07-26 | 877 | 877 | 100% |
| 2026-07-27 | 1.195 | 1.195 | 100% |

A leitura correta da tabela é contraintuitiva: a cobertura **cai** conforme o
dia envelhece. Não é o backfill de itens que regride — é o importador de
**pedidos** que continua trazendo pedidos novos para dias antigos, sem que o
backfill de itens acompanhe. Em `2026-07-27` o dia `21/07` tinha `6.062`
pedidos; no dia anterior tinha bem menos.

### Regra que passou a valer

**Nunca contar pedidos a partir de `olist_order_items`.** Dá cerca de 3x menos
que o real. A separação é:

- **quantidade / unidades** → `olist_order_items`. É a única fonte de unidades
  e deve ser lida como **piso**, nunca como total.
- **pedidos** → `olist_orders`. Completo.

A aba mostra a cobertura num card e num aviso, para que a quantidade nunca
seja lida como número fechado.

## 2. Atraso do importador

Em `2026-07-27T12:05Z` o sync estava rodando (escrita registrada no minuto),
mas o pedido mais novo na base era de `26/07`. Um filtro ancorado em
`current_date` renderizava tela vazia.

Em `2026-07-28T11:48Z` a base já continha `28/07` — ou seja, o atraso é
variável, não permanente. Por isso a tela não assume nem um nem outro:

- as janelas ancoram em `oraculo_olist_last_order_date()`, o último dia **com
  dados**, não em `current_date`;
- quando esse dia é anterior a hoje, um aviso informa o atraso.

## 3. Venda fora de canal distorce o ranking

O pedido `663383` (id `367958030`), de `27/07`, tem `213.960` unidades de
`CABIDE DE VELUDO - PRETO` a `R$ 0,84` — `R$ 179.726,40`. O dado é legítimo:
`payload.valorTotalPedido` bate exatamente com quantidade × valor unitário.

É venda B2B/atacado lançada direto no ERP — `payload.ecommerce.nome` vem
vazio. É **1 pedido em 25.365** na janela de 7 dias e sozinho vale mais
unidades que todos os marketplaces somados (`213.960` contra `~8.700`).

### Regra que passou a valer

Os rankings são de **marketplace**: só entram pedidos com canal. O volume fora
de canal não é descartado — fica no cache com a flag `has_channel = false`, é
devolvido à parte por `oraculo_olist_period_coverage` (`offmarket_orders`,
`offmarket_units`) e a tela mostra quando existe.

## 4. A Shopee direta resolve? Parcialmente

Pergunta levantada em `2026-07-27`: já que a API da Shopee está configurada,
ela não entregaria todos os itens por pedido?

Entrega, sim — e com qualidade melhor que o Olist:

- `shopee_order_items` tem **100% dos pedidos cobertos, todo dia** (medido de
  19/07 a 27/07), contra 26-100% do Olist;
- está mais atual: em `27/07` já tinha `1.045` pedidos do próprio dia, que o
  Olist ainda não havia trazido;
- `28.959` linhas de item em 7 dias, `100%` com SKU preenchido.

Mas não substitui a fonte Olist na aba, por dois motivos:

**Cobre 79% do volume, não 100%.** Shopee são `22.515` dos `28.451` pedidos da
janela. TikTok Shop, Mercado Livre, Amazon, Shein e Kwai — os outros 21% —
continuam dependendo do backfill de itens do Olist.

**Os SKUs estão em namespaces diferentes.** A Shopee traz código de texto do
vendedor; o Olist traz código numérico:

| Olist | Shopee |
|---|---|
| `213992` — KIT BALANÇAS - BIOIMPEDÂNCIA | `BALANÇA-BIOIMPEDANCIA` |
| `213988` — ASSENTO SANITÁRIO ALMOFADADO UNIVERSAL - BRANCO | `ASSENTO_BRANCO` |
| `214146` — JOGO DE TALHERES INOX 25 PEÇAS - PRETO | `JOGO-TALHER-PRETO` |

Só `171` dos `371` SKUs Shopee (`46,1%`) casam com um `olist_products.sku` por
string exata. **Não existe tabela de de-para no projeto** — `oraculo_sku_unit_cost`
assume namespace único, então hoje acerta apenas esses 46%.

Misturar as duas fontes sem mapeamento parte o mesmo produto em duas linhas e
infla o ranking. **O gargalo não é a API, é o de-para** — cerca de 200 SKUs a
mapear.

### Caminhos possíveis (nenhum executado)

- **Aumentar a vazão do backfill de itens do Olist.** Resolve 100% dos canais,
  namespace único, zero mapeamento. Hoje o job
  `oraculo-olist-order-items-backfill-overnight` roda 6x/dia numa janela de
  `03-08 UTC` com `limit: 100` por execução, contra um volume de ~6.000
  pedidos/dia — não tem vazão nem para acompanhar, muito menos para limpar o
  atraso.
- **Usar a Shopee direta para a fatia Shopee.** Único caminho para dado do
  mesmo dia; exige construir o de-para de SKU.

## 5. Desempenho: por que a agregação virou cache

A tela original agregava ao vivo e estourava o `statement_timeout` do compute
Nano na janela de 7 dias. Medições:

| operação | tempo |
|---|---:|
| contar 29k pedidos sem tocar no `payload` | 1,4s |
| a mesma contagem lendo `payload #>> '{ecommerce,nome}'` | 5,0s |
| `oraculo_olist_period_coverage` ao vivo (7 dias) | 8,4s |
| `oraculo_top_channels_qty` ao vivo (7 dias) | 3,1-12,3s |
| leitura pelo cache (qualquer uma) | ~0,0s + rede |

O gargalo é destoastar o `payload` jsonb: `olist_orders` tem `329.661` linhas
e `957 MB`. O nome da loja só existe dentro do payload, então qualquer
agrupamento por canal sobre milhares de pedidos paga esse custo.

Solução no padrão que o projeto já usa (take rate Shopee, NF): cache diário +
`pg_cron`. Detalhes operacionais em `docs/deployment-map.md`.

Custo do refresh — o payload é lido **uma vez** por execução, materializado em
temp table e reaproveitado pelos dois caches; ler duas vezes estourava o
timeout:

| janela | tempo |
|---|---:|
| 10 dias (o que o cron roda) | ~30s |
| 21 dias (populate inicial) | 77s |

**Não** materializar o canal como coluna gerada `stored` em `olist_orders`:
reescreveria 957 MB sob `ACCESS EXCLUSIVE` e travaria o sync. O cache resolve
sem lock.

## Objetos criados

Migrations `20260727120000_oraculo_top_sellers.sql` e
`20260728120000_oraculo_top_sellers_offmarket.sql`:

- `oraculo_olist_qty_channel_daily_cache` — grão dia × canal
- `oraculo_olist_qty_sku_daily_cache` — grão dia × sku × `has_channel`
- `refresh_oraculo_olist_qty_cache(lookback_days)` — service_role
- `oraculo_olist_last_order_date()`
- `oraculo_olist_period_coverage(start, end)`
- `oraculo_top_products_qty(start, end, limit)`
- `oraculo_top_channels_qty(start, end)`

Job: `oraculo-olist-qty-cache`, `20 * * * *`, chamando
`refresh_oraculo_olist_qty_cache(10)`.
