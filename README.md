# Oraculo

Monorepo base for the Oraculo product.

## Purpose

Oraculo is an operations and intelligence platform built around a canonical data layer in Supabase/Postgres, with a web application deployed on Vercel and documentation maintained in Obsidian-friendly markdown.

The key design constraint is portability: another Codex account, another engineer, or another AI agent must be able to enter this repository and recover project context from files alone.

## Repo map

```text
oraculo/
  apps/
    web/              # Next.js app for Vercel
  packages/
    config/           # shared config and constants
    domain/           # domain types and core entities
  supabase/
    functions/        # Edge Functions
    migrations/       # SQL migrations
  docs/
    adr/              # architecture decision records
    runbooks/         # operational procedures
    product/          # product-facing docs
    prompts/          # AI playbooks
  vault/
    ...               # Obsidian knowledge base
```

## First files to read

1. [docs/project-context.md](docs/project-context.md)
2. [docs/engineering-playbook.md](docs/engineering-playbook.md)
3. [docs/deployment-map.md](docs/deployment-map.md)
4. [docs/oraculo-master-plan.md](docs/oraculo-master-plan.md)
5. [docs/project-status-2026-06-25.md](docs/project-status-2026-06-25.md)
6. [docs/runbooks/resume-after-supabase-upgrade.md](docs/runbooks/resume-after-supabase-upgrade.md)
7. [vault/00-home/index.md](vault/00-home/index.md)

## Tooling choices

- `pnpm` workspaces
- `Next.js` for the web app on Vercel
- `Supabase` for database, auth, storage and Edge Functions
- `Obsidian` vault inside the repository for portable project memory

## Current production state

- State updated: `2026-06-25`
- Production URL: `https://oraculo.oliverhome.com.br`
- Primary GitHub repository: `https://github.com/Grupo-Jacartta/oraculo.git`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- Web app: `apps/web`
- Backend/data core: `supabase`
- App authentication: Supabase Auth
- User management: `/usuarios`
- Manual parameters: `/parametros`
- Mobile responsive layout: enabled for dashboard, forms and tables

Current product areas:

- Analytics dashboard with date filters.
- Official fiscal dashboard section based on issued/authorized outbound invoices.
- Orders/channel metrics from cached Supabase views/tables.
- SKU and margin foundation.
- Rupture/no-sale product watchlist.
- Manual parameters by channel, SKU and UF.
- Read-only Shopee Donacor data.

## Official fiscal contract

Official sales and revenue no longer come from order creation or `dataFaturamento` in `olist_orders`.

Validated rule:

- status in `6,7`;
- exclude `tipo = E`;
- exclude `raw_json.origem.tipo = devolucao`;
- fiscal date = invoice emission date;
- official revenue = validated invoice amount.

Validation for `2026-06-01` to `2026-06-19`:

- Olist screen: `71.197` invoices / `R$ 5.243.629,96`;
- Supabase official layer: `71.198` invoices / `R$ 5.243.715,76`.

Official objects:

- `oraculo_fiscal_invoices_valid`
- `oraculo_fiscal_daily_revenue`
- `oraculo_fiscal_channel_sales`
- `oraculo_fiscal_metrics`
- `oraculo_fiscal_channel_metrics`

## Current blocker

SKU fiscal, margin, ROI and ROAS remain blocked because item coverage is insufficient.

Latest audit:

- NF to Olist order link: `71.191` invoices / `99,99%`;
- link field: `olist_orders.payload.ecommerce.numeroPedidoEcommerce`;
- invoices with order items: `702` / `0,99%`;
- fiscal revenue covered by order items: `0,90%`.

The controlled backfill is implemented in `scripts/backfill-olist-order-items-for-valid-invoices.js`, with persistent checkpoint, per-order errors, retry/backoff and automatic coverage audit.

Latest validated commit:

- `c487925` - controlled fiscal backfill for `olist_order_items`

Continue the validated run with:

```bash
node scripts/backfill-olist-order-items-for-valid-invoices.js \
  --start=2026-06-01 \
  --end=2026-06-19 \
  --limit=100 \
  --delay-ms=750 \
  --max-runtime-minutes=15 \
  --resume
```

## Active Supabase jobs

Scheduling is handled inside Supabase through `pg_cron`:

- `oraculo-olist-orders-hourly`: hourly at minute `:05`, incremental order sync.
- `oraculo-olist-derived-hourly`: hourly at minute `:25`, derived metrics/cache sync.
- `oraculo-nf-cache-hourly`: hourly at minute `:35`, NF cache refresh inside Postgres.
- `oraculo-olist-stock-6h`: every 6 hours, stock/product refresh.

The local macOS `launchd` job remains as historical/fallback documentation, not the primary sync owner.

## Runtime configuration

Local development reads secrets from the repository root `.env` file. The web app also falls back to that file when `process.env` is not already populated.

Required variables for the current dashboard:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_REF`
- `OLIST_API_CLIENT_ID`
- `OLIST_API_CLIENT_SECRET`
- `OLIST_API_TOKEN_URL`
- `OLIST_OAUTH_REDIRECT_URI`
- `OLIST_OAUTH_STATE_SECRET`
- `OLIST_API_BASE_URL`
- `OLIST_SYNC_JOB_SECRET`
- `OLIST_API_AUTH_HEADER`
- `OLIST_API_AUTH_PREFIX`
- `OLIST_STOCK_ENDPOINT`

## Portability rule

Any important decision, schema change, workflow change, or agent convention must be reflected in repository files. Chat history is never treated as the source of truth.
