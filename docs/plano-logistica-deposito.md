# Plano — Visão Logística e de Depósito

Aprovado em 2026-08-21. Fase 1 entregue nesta data (ver
`project-status-2026-08-21.md` e o CHANGELOG); fases 2–5 são o roteiro do que
vem depois.

## Princípio de desenho

O estoque oficial é e continua sendo o do Olist/Tiny (ERP). O Oráculo **não é
um WMS concorrente** — ele complementa (posições físicas, conferências,
operações) e **reconcilia** contra o saldo do ERP. Ajuste de saldo acontece no
Olist; o Oráculo registra e aponta divergências.

Usuários: gestão (analítico) e time do depósito (operacional — celular no
galpão e PC fixo). Escopo confirmado com o Juliano: estoque/reposição,
expedição/envios e operação do depósito com **endereçamento por
posição** (rua/coluna/nível) e **lista de picking**. Devoluções ficam fora
(módulo `/devolucoes` já cobre).

## Descobertas que moldaram o desenho (validadas em produção, 21/08)

- A conta Olist tem **8 depósitos**: Geral, FULL ML, Full Shopee Oliver,
  Amazon Onsite, Avarias, Devolução, Importação, Transferência. A flag
  `desconsiderar` do ERP explica por que Avarias/Devolução/Full ficam fora do
  saldo consolidado.
- O payload de `GET produtos/{id}` **não traz** a quebra por depósito nem o
  `reservado` — ambos vêm de `GET /estoque/{idProduto}` (uma chamada extra por
  produto). Por isso `olist_stock_items.depositos` sempre esteve vazio e
  `olist_stock_items.reservado` é sempre NULL.
- `olist_orders.transportador` está preenchido em ~371 mil pedidos e nunca foi
  lido. Shape: `{nome, formaEnvio: {nome}, fretePorConta, codigoRastreamento,
  urlRastreamento}`. **Medido em 23/08:** `nome` vem sempre vazio (0%) e
  `codigoRastreamento` em ~1% — o marketplace despacha, o ERP não registra o
  transporte. Só `formaEnvio.nome` e `fretePorConta` são confiáveis (99,9%).
  `payload.valorFrete` existe em ~2% (só pedidos hidratados).
- `payload.dimensoes` (peso/medidas) existe em ~1/3 dos produtos.
- Generated column em `olist_orders` é proibido (AGENTS.md — rewrite de ~1 GB
  sob ACCESS EXCLUSIVE); em `olist_products` (~3 mil linhas) é seguro.

## Fase 1 — Fundação de dados + estoque unificado (ENTREGUE 2026-08-21)

- `olist_stock_deposits` (produto × depósito), alimentada pelo
  `olist-sync-stock` — busca `/estoque/{id}` só para produtos com movimento ou
  que já tinham linha com movimento (o produto que zerou é re-varrido e
  zerado; o que nunca teve movimento não gasta chamada). Semeadura completa:
  `scripts/backfill-olist-stock-deposits.js`.
- `logistica_depositos` — dimensão curada (tipo, apelido, endereço físico).
- Dimensões físicas em `olist_products` (generated columns de
  `payload.dimensoes`, 0 vira NULL — mesmo trap do `preco_custo`).
- Colunas de envio em `olist_orders` via trigger
  `oraculo_olist_order_logistics_fields()`; backfill por cursor de id em
  `scripts/backfill-olist-orders-transportador.js`.
- View `oraculo_estoque_por_deposito` + `/logistica` (hub com pills) +
  `/logistica/estoque` (tabela com colunas dinâmicas por depósito, sinal da
  watchlist, custo canônico, capital, export xlsx).

## Fase 2 — Recebimento e conferência (ENTREGUE 2026-08-22)

- `logistica_recebimentos` (ref solta a `importacao_faturas`) +
  `logistica_recebimento_itens` (esperado pré-populado de `importacao_itens`:
  cartons × quantity_per_carton; de-para descrição→SKU sugerido).
- `/logistica/recebimento` mobile-first: lista de faturas por chegar →
  conferência item a item. Divergência: ok | falta | sobra | avaria.
- Cruzamento informativo: a tela mostra o saldo Olist de hoje do SKU informado;
  a comparação com a variação nos dias seguintes fica para a Fase 3/4 (precisa
  de histórico por dia em `olist_stock_snapshots` cruzado por SKU).
- Entregue: migration `20260822120000`, `/logistica/recebimento` (lista +
  iniciar) e `/logistica/recebimento/[id]` (conferência item a item, concluir,
  reabrir). Item não conferido ao concluir = falta total, com aviso.

## Fase 3 — Endereçamento por posição + inventário

- `logistica_enderecos` (code `A-01-03`, zona/corredor/posição/nível, QR com o
  gerador de 12 chars de `apps/web/app/logistica/data.ts`) +
  `logistica_endereco_ocupacoes` (palete inteiro OU sku+quantidade avulso;
  histórico por soft-close `removido_em`).
- `logistica_contagens` + `logistica_contagem_itens` (`qty_sistema_snapshot`
  congelado ao abrir; o ajuste acontece NO Olist, o Oráculo registra a
  resolução) + view `oraculo_inventario_divergencias`.
- `/logistica/enderecos` ("onde está o SKU", mover, imprimir QR reusando o
  fluxo da etiqueta) e `/logistica/inventario`.

## Fase 4 — Expedição multi-canal + analítica (REESCRITA em 2026-08-23)

**A premissa original caiu.** O plano de 21/08 dizia que bastava materializar
`olist_orders` para cobrir os canais que não são Shopee. A medição de 23/08
mostrou que o Olist não tem o dado (últimos 30 dias, 138.873 pedidos):

| Campo | Preenchido | Serve para expedição? |
|---|---|---|
| `transportador.nome` | **0,0%** | Não — coluna removida em `20260823170000` |
| `forma_envio` | 99,9% | Sim, mas identifica o **modal do canal**, não a transportadora |
| `frete_por_conta` | 99,9% | Sim (CIF/FOB) |
| `codigo_rastreamento` | ~1% | Não — só Mercado Envios, e em ~40% dos casos dele |
| `valor_frete` | ~2% | Não — só pedidos hidratados |

A causa é estrutural, não um defeito de sync: **quem despacha é o marketplace**.
O ERP registra a venda, não o transporte. Nenhum backfill conserta isso.

### Consequência: a fonte é a API de cada canal

Cada canal precisa da sua própria ingestão de envio, como já existe para a
Shopee. É trabalho maior do que a fase original previa e deve ser fatiado por
canal, não entregue de uma vez.

| Canal | Volume 30d | Fonte de envio | Situação |
|---|---|---|---|
| Shopee | 122.122 | `shopee_fulfillment_packages` + `bip_fulfillment_events` | **Pronto** (`/expedicao`) |
| TikTok | 12.106 | API TikTok Shop (`/order/get_shipping_info`) | Tabelas `tiktok_*` **nunca aplicadas em prod** — checar antes |
| Mercado Livre | 3.568 | API `/shipments/{id}` — existe `mercadolivre_notifications` para disparar | A construir; é o único com rastreio parcial no ERP |
| Kwai | 549 | Sem integração | Fora de escopo por ora |
| Amazon DBA | 351 | Só export manual (ver `amazon-export-e-mapeamento-sku`) | Fora de escopo por ora |

Ordem recomendada: **Mercado Livre primeiro** (volume relevante, API madura,
token já rotativo no `mercadolivre-sync`), TikTok depois (volume maior, mas
exige aplicar as tabelas e revalidar o app).

### O que ainda vale do plano original

- View `oraculo_shipments_unified` continua sendo o destino — mas como união
  das tabelas de envio **por canal**, não de `olist_orders`. O lado Olist entra
  só com `forma_envio` e `frete_por_conta`, para o pedido que nenhum canal
  cobre aparecer como "sem dado de envio" em vez de sumir.
- **Não mexer** em `oraculo_fulfillment_pipeline` (roda em TV no galpão).
- `oraculo_shipments_daily_cache` + `oraculo_logistica_overview_cache` como
  steps novos do `olist-derived-refresh` (zero cron novo — teto de 2/minuto).
- `/logistica/expedicao`: a expedir por canal, atrasos e SLA de despacho.
  **Sai do escopo**: ranking de transportadoras e frete médio por pedido — não
  há dado que sustente nenhum dos dois hoje.

## Fase 5 — Picking (lista de separação)

- `logistica_picking_listas` + `logistica_picking_itens`. Server Action gera a
  lista do dia de `oraculo_shipments_unified` (a expedir) × ocupações de
  endereço, ordenada por corredor/posição. Sem reserva nem baixa por posição —
  continua não sendo WMS. Depende das fases 3 e 4.

## Backlog (fora do plano)

Devoluções na visão logística; reserva/baixa por posição; sugestão de reposição
com lead time de importação; bipes multi-canal no Bip; permissão granular
gestão × depósito; frete na margem por pedido.
