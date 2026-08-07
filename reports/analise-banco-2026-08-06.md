# Análise profunda do banco Oráculo — 2026-08-06

Levantamento feito em produção (Supabase `bbtiipnmdxfxnxbemgjr`, sa-east-1) na tarde
de 06/08, logo após o segundo incidente de indisponibilidade em dois dias.
Todos os números vêm de catálogos (`pg_stat_*`), sem rodar nada pesado.

## 1. Infraestrutura

| item | valor |
|---|---|
| Compute | **Nano** — 428 MB RAM, 2 vCPU compartilhadas |
| Postgres | 17.6 |
| Disco `/data` | 8,4 GB total, 4,9 GB livres |
| Banco | 2,996 GB |
| `shared_buffers` | 224 MB |
| `effective_cache_size` | 384 MB |
| `work_mem` | **2,18 MB** |
| `maintenance_work_mem` | 32 MB |
| `max_connections` | 60 |
| `statement_timeout` | 120 s |
| `max_worker_processes` | 6 (4 ocupados fixos → **2 slots** p/ pg_cron) |

O desequilíbrio central: as duas tabelas quentes somam **1,2 GB de heap**
(olist_orders 791 MB + olist_invoices 414 MB) contra 224 MB de shared_buffers e
428 MB de RAM total. A working set não cabe na máquina — tudo vira leitura de disco.

## 2. Achados, do mais grave ao menor

### 2.1 Write amplification na olist_orders — 0% de HOT updates com 10 índices

- 4.013.002 updates acumulados para 291.765 linhas vivas (**13,7 updates/linha**)
- **n_tup_hot_upd = 0**: nenhum update é HOT
- Causa: o índice `olist_orders_synced_at_idx`. Todo upsert do sync atualiza
  `synced_at`; como a coluna é indexada, o Postgres é obrigado a criar nova versão
  da linha **e atualizar os 10 índices**, a cada passada do cron de 30 min —
  mesmo quando o pedido não mudou nada.
- Uso do índice na vida inteira: **4 scans**. Custo máximo, benefício nulo.
- Consequências: ~300 MB de bloat no heap (791 MB para ~485 MB de dados úteis),
  102 rodadas de autovacuum, WAL e IOPS desperdiçados.

O mesmo padrão, em menor grau:
| tabela | updates | HOT % | observação |
|---|---|---|---|
| olist_orders | 4,0 M | **0%** | synced_at indexado |
| olist_invoices | 3,8 M | 16% | 12 índices |
| olist_order_items | 3,6 M | 54% | |
| **mercadolivre_items** | **3,0 M** | **4%** | para **1.941 linhas** — re-upsert constante de itens que não mudaram (1.530 updates/linha!) |
| mercadolivre_inventory_snapshots | 970 k | 63% | |
| shopee_orders | 540 k | 13% | |

### 2.2 Temp spill: 304 GB escritos em arquivos temporários

`pg_stat_database`: **88.460 arquivos temp, 304 GB** desde 22/05. Com
`work_mem = 2,18 MB`, todo sort/hash das funções de cache estoura para o disco.
Num Nano, cujos IOPS são de burst, isso é o mecanismo mais provável da morte de
hoje: caches pesados + spill esgotam o burst → iowait dispara → host para de
responder → nem conexões novas completam (exatamente o sintoma das 13:54–17:44).

### 2.3 Cache hit péssimo nas tabelas quentes

| tabela | hit % | blocos lidos do disco (acum.) |
|---|---|---|
| olist_orders | **53%** | 120,6 M (~920 GB) |
| olist_invoices | **58%** | 87,9 M (~670 GB) |
| shopee_order_items | **30%** | 16,5 M |
| shopee_orders | 75% | 23,4 M |

Global: heap 77%, índices 99%. `pg_stat_io` mostra **165,8 M blocos (1,26 TB)**
lidos em modo *bulkread* — os seq scans das funções de cache varrendo
olist_orders/invoices repetidamente (1.455 seq scans de ~249 k linhas cada na
olist_orders; 4.469 de ~97 k na olist_invoices).

### 2.4 Rotinas de cache pesadas demais para a frequência que têm

Média dos últimos 7 dias (execuções bem-sucedidas):

| job | freq | média | máx |
|---|---|---|---|
| oraculo-unified-sku-cache | 1×/h | **144 s** | 200 s |
| oraculo-shopee-take-rate-cache | 2×/h | 47 s | 104 s |
| oraculo-olist-qty-cache | 1×/h | 24 s | 46 s |
| oraculo-fiscal-margin-snapshots | 1×/h | 21 s | 81 s |
| oraculo-nf-cache-hourly | 1×/h | 10 s | 19 s |

São **4–6 min de CPU+IO pesado por hora, toda hora**, em 2 vCPUs — além dos ~30
crons de sync. O incidente de hoje começou exatamente com duas dessas rotinas
estourando statement timeout (13:12–13:14) e o dominó de `job startup timeout`
em seguida.

### 2.5 Índices mortos (custo de escrita, zero leitura)

| índice | tamanho | scans |
|---|---|---|
| mercadolivre_notifications_seller_topic_idx | 17 MB | 0 |
| olist_invoice_items_invoice_number_idx | 8,4 MB | 0 |
| olist_orders_numero_ordem_compra_idx | 6,6 MB | 0 |
| olist_orders_synced_at_idx | 6,7 MB | 4 |
| olist_orders_situacao_idx | 6,7 MB | 65 |
| olist_orders_situacao_data_criacao_idx | 12 MB | 651 |

### 2.6 Crescimento sem retenção

- `mercadolivre_notifications`: 153 MB / 158 k linhas, só cresce. É fila de
  webhook — processada, não precisa de histórico eterno.
- `olist_order_item_backfill_queue`: 39 MB / 107 k linhas — fila já processada
  que ninguém purga (24 MB disso é índice).
- `shopee_products`: 201 k seq scans (a tabela é pequena, mas é varrida inteira
  o tempo todo — 771 M de linhas lidas acumuladas).

### 2.7 O que está saudável

- Deadlocks: 0. Rollback rate: 0,2%. Autovacuum acompanhando (dead tuples < 7%
  nas grandes). Disco com folga (4,9 GB livres p/ banco de 3 GB). Sem
  transações presas, sem locks. Os índices que o app realmente usa
  (pkey, ecommerce_numero_pedido, numero_pedido) têm milhões de scans — o
  desenho das consultas do app está certo; o problema é carga de fundo, não o app.

## 3. Diagnóstico consolidado

O banco não tem problema de modelagem grave nem de volume (3 GB é pouco). Ele tem
**três multiplicadores de IO rodando numa máquina de 428 MB**:

1. upserts cegos que reescrevem linhas idênticas milhões de vezes (0–16% HOT),
2. funções de cache que varrem as tabelas grandes toda hora e derramam 304 GB
   de temp no disco por falta de work_mem,
3. working set 3× maior que a RAM → cache hit de 53–58% onde mais dói.

Os dois incidentes são o mesmo fenômeno com gatilhos diferentes: o Nano opera
sem margem; qualquer coincidência (colisão de agenda ontem, pico de IO hoje)
derruba o host inteiro.

## 4. Recomendações

### Imediatas (sem custo, baixo risco)

1. **Dropar `olist_orders_synced_at_idx`** — destrava HOT updates na tabela mais
   quente (nenhuma outra coluna indexada muda no upsert de rotina). Maior
   ganho unitário disponível.
2. Dropar os demais índices mortos (§2.5) — ~50 MB a menos de escrita por update.
3. **Upsert condicional** nos syncs: `on conflict ... do update set ... where
   <tabela>.data_atualizacao is distinct from excluded.data_atualizacao`
   (e equivalente para mercadolivre_items, o caso mais absurdo: 1.530
   updates/linha). Elimina a maior parte dos 12 M de updates no-op.
4. **`set local work_mem = '32MB'`** dentro das 4 funções de cache pesadas —
   mata o grosso dos 304 GB de temp spill sem arriscar OOM global.
5. Retenção: purgar `mercadolivre_notifications` > 30 dias e itens concluídos da
   `olist_order_item_backfill_queue` (job semanal).
6. Espaçar `oraculo-unified-sku-cache` (144 s/execução) para a cada 2–3 h, ou ao
   menos tirá-lo do horário comercial cheio.

### Estruturais

7. **Upgrade de compute Nano → Small (2 GB RAM)** — o Micro (1 GB) já ajuda, mas
   com working set de ~1,2 GB o Small é o primeiro tamanho em que as tabelas
   quentes cabem em cache. É a única medida que dá *margem*; todas as outras
   reduzem consumo mas mantêm o sistema operando no limite.
8. Depois do item 3 assentar: `VACUUM FULL olist_orders` em madrugada
   (791 → ~500 MB, trava a tabela ~1–2 min) para recuperar o bloat histórico.
9. Médio prazo: separar `payload` jsonb da `olist_orders` em tabela satélite —
   as varreduras analíticas deixam de arrastar 1 KB de jsonb por linha
   (consistente com o gargalo já documentado em memória/AGENTS).

## 5. Incidentes de referência

- **05/08 16:30–18:45 UTC**: colisão de agenda de crons nos 2 worker slots
  (corrigido pela migration `20260805190000_spread_cron_minutes_to_free_worker_slots.sql`,
  ainda não commitada).
- **06/08 13:12–17:49 UTC**: saturação de IO/CPU do host — statement timeouts
  nas rotinas de cache às 13:12, `job startup timeout` em cascata a partir das
  13:15, host inacessível ~13:54, recuperado com restart do projeto às 17:44–17:49.
