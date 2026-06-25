# Oraculo - Status do Projeto

Data: `2026-06-25`

## Producao

- App: `https://oraculo.oliverhome.com.br`
- Repositorio principal: `https://github.com/Grupo-Jacartta/oraculo.git`
- Espelho pessoal: `https://github.com/julianocalill/oraculo-jacartta`
- Frontend: Next.js em `apps/web`
- Backend canonico: Supabase/Postgres
- Deploy: GitHub `main` conectado a Vercel

## Entregue

- Login e controle de usuarios com Supabase Auth.
- Dashboard responsivo para desktop e mobile.
- Parametros manuais por canal, SKU e UF.
- Integracao Olist com pedidos, produtos, estoque e notas fiscais.
- Integracao Shopee Donacor somente leitura.
- Sync Olist incremental e caches operacionais por `pg_cron`.
- Tabelas canonicas de notas e itens fiscais.
- Auditorias de reconciliacao fiscal.
- Camada fiscal oficial no dashboard.

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

## Cobertura de Itens

- NFs validas: `71.198`;
- NFs vinculadas a pedido: `71.191` (`99,99%`);
- campo de vinculo: `olist_orders.payload.ecommerce.numeroPedidoEcommerce`;
- NFs com item fiscal puro: `25` (`0,04%`);
- NFs com itens via pedido: `702` (`0,99%`);
- receita fiscal coberta via pedido e itens: `0,90%`.

Conclusao:

- o vinculo NF-pedido esta validado;
- o gargalo e a falta de `olist_order_items`;
- SKU fiscal, margem, ROI e ROAS continuam bloqueados.

## Backfill Implementado

`scripts/backfill-olist-order-items-for-valid-invoices.js` foi criado e validado.

Entregue:

- selecao somente de pedidos vinculados a NFs validas e sem itens;
- ponte materializada `oraculo_fiscal_invoice_order_links`;
- parametros de inicio, fim, limite, delay, runtime e resume;
- checkpoint persistente;
- retry/backoff para rede, `429` e `5xx`;
- upsert com payload bruto;
- registro de erros por pedido;
- relatorio JSON e auditoria automatica.

Lote validado:

- `12` pedidos processados;
- `12` pedidos com itens;
- `0` sem itens;
- `0` erros;
- cobertura atual: `702` NFs / `0,99%`;
- gate ainda nao atingido.

Gate:

- cobertura de NFs via itens >= `98%`; ou
- receita fiscal sem cobertura < `0,5%`.

Depois do gate:

1. Criar `oraculo_fiscal_sku_sales_by_order_link`.
2. Auditar distribuicao de receita e quantidade por SKU.
3. Somente depois liberar margem, ROI e ROAS por SKU.

## Documentos Principais

- `docs/project-context.md`
- `docs/oraculo-master-plan.md`
- `docs/metric-contract.md`
- `docs/nf-faturada-audit.md`
- `docs/nf-faturada-value-reconciliation.md`
- `docs/fiscal-sku-items-coverage.md`
- `docs/runbooks/context-handoff.md`

## Commits de Referencia

- `c487925` - backfill controlado de itens de pedido para NFs fiscais validas;
- `d26efb9` - atualizacao documental ate a auditoria fiscal de itens;
- `1b61a8c` - camada fiscal oficial;
- `7bcf78a` - auditoria de cobertura de itens fiscais.
