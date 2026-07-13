# Quick Start — Oráculo

Guia rápido para rodar, entender e modificar o projeto.

## Installation

### Prerequisites
- Node.js 20+ (or latest LTS)
- `pnpm` (install via `npm i -g pnpm`)
- Supabase account with project ref `bbtiipnmdxfxnxbemgjr`
- Vercel account (for deployment)

### Local setup

```bash
# 1. Clone repo
git clone https://github.com/Grupo-Jacartta/oraculo.git
cd oraculo

# 2. Install dependencies
pnpm install

# 3. Copy .env.example to .env and fill in secrets
cp .env.example .env
# Required vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OLIST_API_* (see README.md)

# 4. Start dev server
pnpm --filter web dev
# Opens http://localhost:3000 (login required)

# 5. (Optional) Run tests
pnpm test  # fiscal domain tests in packages/domain/fiscal.test.js
```

## Project structure

```text
apps/web/                   # Next.js app (Vercel)
  app/
    page.tsx               # dashboard (main entry)
    skus/
      page.tsx             # SKU ranking with fiscal margin
      sku-table.tsx        # ← client component, sortable table
    [other pages]/
    components/
      fiscal-charts.tsx    # ← SVG charts (tax donut, gauges, area)
    globals.css            # ← dark theme tokens & shared styles
  lib/
    fiscal-snapshots.ts    # ← snapshot loaders

packages/domain/
  fiscal.js                # pure fiscal calculation functions
  fiscal.test.js           # 22 test cases

supabase/
  migrations/
    20260710160000_*       # ← latest migrations (snapshots, RLS)
  functions/               # edge functions (if used)

docs/
  project-status-2026-07-10-final.md  # ← read this first
  engineering-playbook.md
  fiscal-financeiro-port.md
  deployment-map.md
```

## Key files to understand

### Dark theme
**File**: `apps/web/app/globals.css` (lines 1–49)

All colors are CSS custom properties (`--bg`, `--panel`, `--indigo`, etc.). To change the theme, edit `:root` token values — no hardcoded hex in component styles.

```css
:root {
  --bg: #0b0e15;           /* dark ink background */
  --text: #eef1f8;         /* light text */
  --gold: #f6c453;         /* brand accent */
  --indigo: #6d8bff;       /* data viz */
  /* ... etc */
}
```

### Sortable table
**File**: `apps/web/app/components/sortable-table.tsx` (generic — use this for new tables)

Client component (`"use client"`) with state-based sorting (`useState` + `useMemo`). Rows are arrays of serializable cells (`{ text, sort, href?, badge?, subtitle? }`) built on the server and passed in — no sorting logic duplicated per page. Used on `/alertas`, `/curva-de-venda`, `/curva-de-estoque`. `/skus` keeps its own dedicated `sku-table.tsx` (same pattern, built first, not yet migrated to the generic component).

### Fiscal snapshots
**File**: `apps/web/lib/fiscal-snapshots.ts`

Three snapshots, refreshed **hourly** (not nightly — see migration `20260710190000`):
- `fiscal_margin_summary` — totals (revenue, cost, taxes, profit, margin %, ROI).
- `fiscal_sku_margin` — per-SKU breakdown (array of rows).
- `fiscal_channel_metrics` — revenue by channel.

Loaders: `loadFiscalMarginSummarySnapshot()`, `loadFiscalSkuMarginSnapshot()`, `loadFiscalChannelMetricsSnapshot()`. On the current-month window these are instant reads; on a custom date window the dashboard falls back to a live RPC call (see `loadFiscalMargin`/`loadFiscalChannels` in `app/page.tsx`).

Used on: dashboard (page.tsx), `/skus` (page.tsx).

### Metric cards with growth curves
**File**: `apps/web/app/page.tsx` (`MetricCard` component + `Sparkline` from `app/components/fiscal-charts.tsx`)

Every metric card can take an optional `delta` (variation chip) and `spark` (array of numbers → growth curve). Only pass them when you have an honest series — don't fabricate a trend. See how the dashboard builds `revenueDelta`, `profitDelta`, etc. from either the daily fiscal series (vs. same day-cut of previous month) or the hourly snapshot history (first vs. last capture in range).

### Pricing calculator
**File**: `apps/web/app/calculadora/calculator.tsx` (client) + `apps/web/app/calculadora/page.tsx` (server)

Standalone rules ported from the external `calculadora.oliverhome.com.br` project — intentionally does not import from `packages/domain/fiscal.js` or read Oráculo's fiscal snapshots. Marketplace presets (Shopee/ML/TikTok) are plain data objects (`MARKETPLACE_PRESETS`); add a new marketplace by adding a preset, not new logic.

### Database migrations
**Directory**: `supabase/migrations/`

Apply migrations with:
```bash
npx supabase db query --linked --file <migration-file>
```

**Never** use `db push` — it reapplies non-idempotent migrations. Latest migrations:
- `20260710190000` — snapshot capture moved from nightly to hourly, 14-day retention.
- `20260712100000` — snapshot history readable by `authenticated` (powers card sparklines).

## Common tasks

### Update the dark theme
1. Open `apps/web/app/globals.css`.
2. Edit `:root` token values (lines 1–49).
3. Test locally (`pnpm --filter web dev`).
4. Commit & push; Vercel deploys automatically to production.

### Add sorting to a table
1. Create a new client component (e.g., `MyTable.tsx`) with `"use client"`.
2. Import `useMemo`, `useState`, React.
3. Define a `SortKey` type and `COLUMNS` config (label, numeric, value).
4. Add `compare()` function (numeric vs. string sorting, nulls last).
5. Use `useMemo` to sort data in the render.
6. Add CSS for `.th-sort` button styling (see globals.css lines 1927–1938).

### Add a fiscal calculation
1. Add pure function to `packages/domain/fiscal.js`.
2. Write test cases in `fiscal.test.js`.
3. Run `pnpm test` to verify.
4. Import in the SQL migration or TypeScript loader.

### Add a new chart
1. Create an SVG component in `apps/web/app/components/fiscal-charts.tsx` (server-rendered, no JS).
2. Define input props (e.g., data array).
3. Add CSS styling to `globals.css`.
4. Import & use in page.tsx or another server component.

### Deploy to production
1. Push to `main` branch.
2. Vercel auto-deploys (via GitHub action).
3. Verify at `https://oraculo.oliverhome.com.br`.

Or manually:
```bash
vercel deploy --prod --yes
```

## Debugging

### Dashboard 500 error?
1. Check Vercel logs: `vercel logs <deployment-url>`.
2. Look for "57014" (Postgres statement timeout). If found, a query exceeded 8s under `authenticated` role.
3. Migrate heavy logic to snapshots (see `docs/project-status-2026-07-10-final.md` for the pattern).

### Query not appearing?
1. Verify RLS policies: `select * from pg_policies where tablename = '<table>';` in Supabase SQL.
2. Ensure authenticated client has a grant on the table: `grant select on <table> to authenticated;`.
3. Check the view/function has `security definer` if it needs elevated privileges.

### Chart not rendering?
1. Verify data passed to the component (console.log in server component).
2. Check SVG viewBox & responsive sizing.
3. Ensure CSS variables (--indigo, --panel, etc.) are defined in `:root`.

## Next steps

- Read [docs/project-status-2026-07-10-final.md](project-status-2026-07-10-final.md) for the latest feature summary.
- Read [docs/engineering-playbook.md](engineering-playbook.md) for dev conventions.
- Explore [docs/fiscal-financeiro-port.md](fiscal-financeiro-port.md) to understand the fiscal rules.
- Join the Supabase project and explore the schema (tables, views, functions, RLS policies).
