# Oraculo - Status do Projeto

Data: `2026-07-03`

## Producao

- App: `https://oraculo.oliverhome.com.br`
- Repositorio principal: `https://github.com/Grupo-Jacartta/oraculo.git`
- Espelho pessoal: `https://github.com/julianocalill/oraculo-jacartta`
- Frontend: Next.js em `apps/web`
- Backend canonico: Supabase/Postgres
- Deploy: Vercel, com dominio de producao apontado para o ultimo deploy aprovado.

## Entregue desde 2026-06-27

- Layout do dashboard alterado para tema claro, branco e mais leve.
- Fallback local de auth para desenvolvimento sem senha em localhost.
- `.vercelignore` criado para evitar envio de `.env`, `tmp/`, logs, reports e artefatos locais.
- Migration fiscal corrigida para criar snapshots sem sintaxe invalida de `grant/revoke on view`.
- `oraculo_fiscal_channel_metrics` otimizado para ler `oraculo_fiscal_channel_sales`.
- Dashboard deixou de executar consultas pesadas no render server-side.
- Importacao manual de julho executada:
  - NF fiscal: `5.856` notas upsertadas e `5.965` itens;
  - pedidos Olist: `6.473` pedidos entre `2026-07-01` e `2026-07-31`;
  - hidratacao detalhada de pedidos foi interrompida apos cerca de `800` pedidos, portanto nao deve ser tratada como completa.
- Edge Function `olist-sync-invoices` criada e publicada.
- Cron fiscal automatizado no Supabase:
  - `oraculo-olist-invoices-15m`;
  - `oraculo-olist-invoices-monthly-deep`.
- Ranking de SKUs do index religado usando a fonte cacheada `oraculo_sku_current_unified`.
- Filtro padrao do dashboard e da pagina `/pedidos` agora usa o mes vigente em `America/Sao_Paulo`.
- URLs legadas com `start=2026-06-01&end=2026-06-30` sao normalizadas para o mes vigente.
- Cabecalho fiscal deixou de usar texto hardcoded de junho e agora deriva o mes do filtro ativo.

## Estado Fiscal Atual

Consulta de validacao em `2026-07-03` para o periodo `2026-07-01` a `2026-07-31`:

- NFs validas: `7.186`
- Receita faturada: `R$ 688.547,55`
- Dados ate: `2026-07-03`

Regra fiscal oficial permanece:

- status fiscal em `6` ou `7`;
- excluir `tipo = E`;
- excluir `raw_json.origem.tipo = devolucao`;
- data fiscal = emissao da NF;
- receita oficial = valor validado da NF.

## Fiscal Por Canal

O agrupamento `Sem canal` significa que a NF fiscal valida nao trouxe nenhum identificador de canal no payload da Olist:

- `integration_name` vazio;
- `marketplace_name` vazio;
- `channel_name` vazio;
- `raw_json.ecommerce.nome` vazio.

No periodo de julho de 2026, `Sem canal` soma `18` NFs e `R$ 179.642,32`. Quase todo o valor vem da NF `394638`, de `R$ 178.500,00`, com origem `venda`, pedido Olist `364696458` e ecommerce vazio (`id = 0`, `nome = ""`, `canalVenda = ""`). Ela deve ser investigada pelo negocio como possivel venda direta/manual/atacado/B2B antes de renomear ou redistribuir o canal.

## Runtime do Dashboard

Permitido em request-time:

- `oraculo_fiscal_daily_revenue`;
- `oraculo_fiscal_channel_metrics`;
- `oraculo_fiscal_latest_snapshots`;
- `oraculo_sku_current_unified` para ranking parcial/cacheado de SKUs.

Proibido no render server-side da Vercel:

- `oraculo_fiscal_metrics`;
- `oraculo_fiscal_order_item_backfill_progress`;
- `oraculo_sku_period_rank_unified` para periodos grandes;
- auditorias e RPCs pesadas de cobertura.

Motivo: esses caminhos ja causaram timeout Supabase `57014` ou latencia inaceitavel em producao.

## Jobs Ativos

- `oraculo-olist-orders-hourly`: pedidos Olist incrementais.
- `oraculo-olist-derived-hourly`: metricas/cache operacionais.
- `oraculo-nf-cache-hourly`: cache de NFs no Postgres.
- `oraculo-olist-stock-6h`: estoque/produtos.
- `oraculo-olist-invoices-15m`: NFs recentes, lotes curtos com checkpoint.
- `oraculo-olist-invoices-monthly-deep`: catch-up fiscal diario do mes vigente.

## Commits Recentes

- `f26b677` - automate fiscal invoice sync.
- `ea003d5` - restore cached SKU ranking on dashboard.
- `7aae605` - default dashboard filters to current month.
- `8d4b730` - fix current fiscal period header.

## Pendencias Locais Conhecidas

Continuam fora de commit por serem pendencias separadas:

- `supabase/migrations/20260701120000_create_product_cost_snapshots.sql`
- `tmp/`
