# Oraculo - Status do Projeto

Data: `2026-06-27`

## Producao

- App: `https://oraculo.oliverhome.com.br`
- Repositorio principal: `https://github.com/Grupo-Jacartta/oraculo.git`
- Espelho pessoal: `https://github.com/julianocalill/oraculo-jacartta`
- Frontend: Next.js em `apps/web`
- Backend canonico: Supabase/Postgres
- Deploy: GitHub `main` conectado a Vercel

## Entregue

- Login e controle de usuarios com Supabase Auth.
- Dashboard fiscal responsivo para desktop e mobile.
- Parametros manuais por canal, SKU e UF.
- Integracao Olist com pedidos, produtos, estoque e notas fiscais.
- Integracao Shopee Donacor somente leitura.
- Sync Olist incremental e caches operacionais por `pg_cron`.
- Tabelas canonicas de notas e itens fiscais.
- Auditorias de reconciliacao fiscal.
- Camada fiscal oficial no dashboard.
- Snapshot leve para cards fiscais e cobertura SKU em `oraculo_fiscal_snapshots`.

## Contrato Fiscal Oficial

Venda oficial:

- NF faturada de saida;
- status `6` ou `7`;
- excluir `tipo = E`;
- excluir `raw_json.origem.tipo = devolucao`.

Receita oficial:

- valor fiscal validado da NF;
- data de referencia = emissao da NF.

Validacao de `2026-06-01` a `2026-06-19`:

- Tela Olist: `71.197` NFs / `R$ 5.243.629,96`;
- Supabase: `71.198` NFs / `R$ 5.243.715,76`;
- diferenca: `+1` NF / `+R$ 85,80`.

## Runtime do Dashboard

O dashboard pode ler em tempo de request:

- `oraculo_fiscal_daily_revenue`;
- `oraculo_fiscal_channel_metrics`;
- `oraculo_fiscal_latest_snapshots`.

O dashboard nao deve chamar durante render server-side:

- `oraculo_fiscal_metrics`;
- `oraculo_fiscal_order_item_backfill_progress`;
- auditorias ou RPCs pesadas de cobertura.

Motivo: esses caminhos ja causaram timeout Supabase `57014` em producao/Vercel.

## Cobertura de Itens

- NFs validas: `71.198`;
- NFs vinculadas a pedido: `71.191` (`99,99%`);
- campo de vinculo: `olist_orders.payload.ecommerce.numeroPedidoEcommerce`;
- NFs com item fiscal puro: `25` (`0,04%`);
- NFs com itens via pedido: `30.987` (`43,52%`);
- receita fiscal coberta via pedido e itens: `R$ 2.198.329,66` (`41,92%`);
- receita fiscal sem cobertura de itens: `R$ 3.045.386,10` (`58,08%`);
- SKUs distintos via pedido vinculado: `376`.

Conclusao:

- o vinculo NF-pedido esta validado;
- o gargalo atual e completar `olist_order_items` para pedidos vinculados;
- SKU fiscal, margem, ROI e ROAS continuam bloqueados.

## Backfill Controlado

`scripts/backfill-olist-order-items-for-valid-invoices.js` esta implementado e validado.

Entregue:

- fila materializada `olist_order_item_backfill_queue`;
- preparacao paginada da fila por `scripts/prepare-olist-order-item-backfill-queue.js`;
- selecao somente de pedidos vinculados a NFs validas e sem itens;
- ponte materializada `oraculo_fiscal_invoice_order_links`;
- checkpoint persistente;
- retry/backoff para rede, `429` e `5xx`;
- concorrencia controlada por `--concurrency`;
- upsert em lote de itens por pagina de candidatos;
- metricas de performance no relatorio JSON;
- registro de erros por pedido;
- auditoria de cobertura separada.

Configuracao operacional atual:

```bash
node scripts/backfill-olist-order-items-for-valid-invoices.js \
  --start=2026-06-01 \
  --end=2026-06-19 \
  --limit=2000 \
  --delay-ms=900 \
  --max-runtime-minutes=60 \
  --resume \
  --skip-audit \
  --concurrency=2
```

Depois de cada lote:

```bash
node scripts/audit-oraculo-fiscal-metrics.js --start=2026-06-01 --end=2026-06-19 --write-snapshot
node scripts/audit-olist-invoice-items-coverage.js --start=2026-06-01 --end=2026-06-19 --write-snapshot
```

Gate:

- cobertura de NFs via itens >= `98%`; ou
- receita fiscal sem cobertura < `0,5%`.

Depois do gate:

1. Criar `oraculo_fiscal_sku_sales_by_order_link`.
2. Auditar distribuicao de receita e quantidade por SKU.
3. Somente depois liberar margem, ROI e ROAS por SKU.

## Documentos Principais

- `README.md`
- `docs/project-context.md`
- `docs/oraculo-master-plan.md`
- `docs/metric-contract.md`
- `docs/nf-faturada-audit.md`
- `docs/nf-faturada-value-reconciliation.md`
- `docs/fiscal-sku-items-coverage.md`
- `docs/runbooks/context-handoff.md`
- `vault/00-home/index.md`

## Commits de Referencia

- `c4b2766` - fiscal revenue dashboard MVP;
- `a5f853f` - remove heavy SKU coverage RPC from render;
- `ab536d5` - use fast fiscal daily metrics on dashboard.
