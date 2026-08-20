# Estado do projeto — 19/08/2026 (Previsão de Vendas)

## Nova aba: Previsão de Vendas (`/previsao-de-vendas`)

Previsão de unidades da **próxima semana** (segunda a domingo) para a
logística trabalhar produção e previsibilidade. Registrada em
`lib/auth/tabs.ts` como `previsao-de-vendas` (masters veem automaticamente;
demais usuários via `/usuarios`).

### Regras de cálculo (todas visíveis na tela)

- **Base** = média simples das unidades das **últimas semanas completas (até
  4)** (marketplaces Olist; B2B/"Sem canal" fica fora e aparece como KPI à
  parte). **Piso do histórico: 03/08/2026** (decisão de 20/08, ver seção do
  backfill) — semanas anteriores não entram em nada; semana usada com cobertura
  de itens < 90% gera aviso em `calc_note` na tela.
- **Tendência** = média(4 recentes) ÷ média(4 anteriores), limitada a ±30%;
  sem 2 semanas anteriores, tendência = 1. O valor cru também é exposto.
- **Previsão** = base × tendência. **Faixa** = previsão × (1 ± cv), onde cv =
  desvio/média das 8 últimas semanas, limitado a 5–50%.
- **Dia a dia**: share de unidades por dia da semana nas 8 semanas completas
  (Σ dias = total por construção).
- **Por canal**: share do canal nas 4 semanas-base × total (Σ canais = total);
  a tendência 4v4 do próprio canal é coluna informativa.
- **Por SKU**: média das k semanas-base em que o SKU existiu (k ≤ 4; SKU novo
  ganha flag) × tendência geral. Sem venda nas semanas-base = fora da tabela.
- **Sem ligação com estoque** (decisão de 20/08): o primeiro corte trazia
  cobertura/situação/sugestão de compra cruzando com `olist_products.disponivel`,
  mas o público da aba é a logística (produção/previsibilidade) e o `disponivel`
  do ERP não enxerga o saldo posicionado no ML Full nem no FBS Shopee — as
  colunas foram removidas da RPC, da tela e do CSV. Estoque é assunto da Curva
  de Estoque.
- **Semana completa** = 7 dias no cache E terminada até `anchor − 1`
  (`oraculo_olist_last_order_date()`) E anterior à semana-alvo — a previsão
  nunca enxerga dados da própria semana prevista, o que torna o backtest
  honesto.

### Implementação

- Migration `supabase/migrations/20260819210000_oraculo_sales_forecast.sql`:
  5 RPCs `stable` (`oraculo_sales_forecast_week/daily/channels/skus/backtest`)
  lendo **só** `oraculo_olist_qty_channel_daily_cache` e
  `oraculo_olist_qty_sku_daily_cache` — sem cache novo, sem cron novo.
- Frontend: `apps/web/app/previsao-de-vendas/` (page + data + export CSV),
  gráfico SVG server-rendered novo (`app/components/forecast-chart.tsx`:
  histórico sólido, semana em andamento esmaecida, previsão tracejada com
  banda low–high). Filtro `?semana=` permite ver a previsão de qualquer semana
  (backtest visual).
- Painéis de auditoria na tela: semanas usadas (com cobertura de itens por
  semana) e backtest previsão vs realizado das 4 últimas semanas.
- `/status`: nova linha "Cache de quantidade (Previsão de Vendas)" com alerta
  se o cache não atualizou hoje.

### Backfill dos qty caches (executado 19/08) e piso do histórico (20/08)

Os caches começavam em ~06/07 e as semanas de 20/07 e 27/07 congelaram com
~30% de cobertura de itens (unidades 3–4x subcontadas). O job one-shot
`oraculo-qty-cache-backfill-once` (pg_cron `:02`, auto-desagenda) rodou
`refresh_oraculo_olist_qty_cache(120)` e se desagendou (confirmado 20/08),
mas o rerun **não recupera** a cobertura: os pedidos de junho/julho seguem sem
`payload.itens` hidratado — só a re-hidratação dos pedidos (sync lento, ~13h
por 3 dias) resolveria. Decisão do Juliano (20/08): **piso do histórico em
03/08/2026** (primeira segunda ≥ 01/08, cobertura 100%) e aviso na tela quando
uma semana usada tiver cobertura < 90%. Efeito imediato: base = 2 semanas
(03/08: 43.887 un · 100%; 10/08: 36.127 un · 100%) ⇒ previsão de 24–30/08 =
**40.007 un** (faixa 34.520–45.494), tendência neutra e backtest vazio até
acumular semanas; tudo se normaliza sozinho com o passar das semanas. Detalhe
no `docs/deployment-map.md` (seção Supabase Cron).

### Limitações aceitas (v1)

- Bucket diário Olist é UTC (~3h de deslocamento vs BRT) — viés consistente na
  história toda; a curva seg–dom é aproximada.
- Tabela por SKU é total-marketplaces (o cache de SKU só tem o boolean
  `has_channel`, não o nome do canal).
- Histórico útil começa em 03/08/2026 (piso por cobertura de itens): sem
  sazonalidade anual e, nas primeiras semanas, sem tendência nem backtest;
  campanhas (ex.: 9.9 Shopee) vão furar a previsão — o painel de acurácia
  existe para expor, não esconder.
- Anotado para v2: mediana em vez de média, cv por SKU, canal por SKU, explosão
  de kits em componentes, multiplicador de lead time na sugestão de compra.
