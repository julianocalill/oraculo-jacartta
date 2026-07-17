# AGENTS

This repository is designed to preserve project continuity across different Codex accounts, AI tools and engineers.

## Read order

1. `README.md`
2. `docs/project-context.md`
3. `docs/engineering-playbook.md`
4. `docs/deployment-map.md`
5. `docs/adr/ADR-001-repo-structure.md`
6. `vault/00-home/index.md`

## Non-negotiable rule

Important context must live in repository files, not only in chat history.

## Expected behavior

- keep structural decisions documented
- keep runbooks current
- keep product, architecture and code aligned
- prefer portable markdown context over account-specific memory

## Current architecture highlights

### UI/Frontend (as of 2026-07-17)
- **Dark theme** with token-based design: cool near-black background, ouro accent, jewel palette (indigo/violet/cyan/emerald/rose).
- **Persistent shell**: `AppShell` + `SidebarNav` (client, `usePathname`) on every authenticated page (13 sidebar links / 18 `page.tsx`). Exact global alert badge via `lib/alert-count.ts`.
- **Metric cards**: shared `MetricCard` component (in `app/page.tsx`) with sparkline + variation chip, used across the app — not a one-off dashboard element. Delta color inverts for cost/taxes (rising is bad).
- **Sorted tables**: `/skus` has a dedicated client component (`useMemo` + `useState`); everywhere else uses the generic `app/components/sortable-table.tsx` (serializable cells: text/sort/href/badge/subtitle). Click headers to sort, click again to reverse, nulls always last.
  - Columns take an optional `hint`: renders a "?" mark + hover tooltip explaining the metric (pure CSS, `.sr-only` copy for screen readers). Hint texts are centralized in `apps/web/lib/column-hints.ts` so ML and Shopee explain the same metric with the same words — write new hints there, not inline.
- **SVG charts** (server-rendered, no client JS): tax composition donut, margin/ROI gauges, daily revenue area with dashed average line.
  - Single exception to "no client JS": the Importações map (`app/importacoes/leaflet-map.tsx`) is a Leaflet client component loaded via `next/dynamic` with `ssr: false` — Leaflet touches `window` on import.
- **Layout invariant**: `.workspace > * { min-width: 0 }`. Grid items default to `min-width: auto` and inflate to their content's intrinsic width, which made wide tables drag the whole page horizontally and push the sidebar off-screen. Wide content must scroll inside `.table-wrap`, never the document.
- **Visual identity**: `BrandMark` component (SVG inline, same source as favicon) — see `docs/brand-oraculo.md`.
- **Pricing calculator** (`/calculadora`): standalone rules, does not touch the fiscal engine. Marketplace presets are data, not logic — see `apps/web/app/calculadora/calculator.tsx`.

### Backend & data (as of 2026-07-17)
- **Three channels with their own ingestion** (all autonomous via pg_cron → Edge Functions; cadence and ownership in `docs/deployment-map.md`):
  - **Olist** — orders, stock, fiscal invoices; the primary revenue source.
  - **Mercado Livre** — `mercadolivre-sync` (`:55`) + notification inbox; sole owner of its rotating refresh token.
  - **Shopee** — 4 shops, each with its **own partner app** (sign with that shop's key; `invalid_access_token` is usually a wrong signature, not an expired token). `shopee-sync` is the **sole token renewer**; every other Shopee function only reads the token.
  - **Importações** — `importacoes-ais-sync` (6h) writes AIS vessel positions.
- **Channel analytics share one language**: sell-through speed over *days in stock*, rupture in R$/day, ABC 80/15/5, and a justified replenishment suggestion. Rules live in `docs/project-status-2026-07-17.md`.
- **Unit cost book**: view `oraculo_sku_unit_cost` (migration `20260716240000`) resolves cost per marketplace SKU — manual override > `olist_products` (ignoring R$ 0, which most ERP SKUs have) > kit effective cost. ML and Shopee both read it; don't re-implement cost resolution per page.
- **Fiscal snapshots** (hourly via pg_cron, `**:15`, 14-day retention — migration `20260710190000`): `fiscal_margin_summary`, `fiscal_sku_margin`, `fiscal_channel_metrics`.
  - Current-month window (default) reads snapshots (instant); a custom date window computes live via RPC with try/catch degradation — never silently shows the wrong month.
  - Snapshot **history** (not just latest) is readable by `authenticated` (migration `20260712100000`) to power card sparklines.
  - All queries tested under `authenticated` role with 8s timeout; none exceed.
- **RLS + auth**: business-data reads via authenticated client (anon key + user JWT); service-role reserved for writes/admin.
- Fiscal layer: Financeiro rules (Jacarta profile, Lucro Real + RET), kit cost expansion by component, per-SKU margin/ROI with tax decomposition.
- **Two traps that already cost real bugs**:
  - **PostgREST caps at 1.000 rows** — channel pages paginate with `fetchAllPages`.
  - **Aggregates never come from the sync's own window** — they are recomputed from the `*_sales_daily` series by RPC; a 2-day cron window once distorted the rupture numbers.

### Deployment
- Vercel (auto-deploy on main push via `vercel deploy --prod`).
- Supabase project: ref `bbtiipnmdxfxnxbemgjr`, linked to prod.
- Secrets in `.env` (local dev) and Vercel environment variables (production).

## Making changes

1. **CSS**: dark theme tokens live in `apps/web/app/globals.css` (`:root`). Edit token values, not hardcoded colors.
2. **Fiscal logic**: pure functions in `packages/domain/fiscal.js`, tested in `fiscal.test.js`. Run `pnpm test` to verify. Never let the standalone calculadora (`/calculadora`) read from or write to this layer — it's intentionally independent.
3. **Database**: add migrations in `supabase/migrations/`, apply via `npx supabase db query --linked --file <migration>` (never use `db push`).
4. **Tables**: prefer `app/components/sortable-table.tsx` (generic, serializable cells) for new sortable tables; `/skus` keeps its dedicated component for historical reasons. Explain calculated columns with `hint`, and put the text in `lib/column-hints.ts`.
5. **Charts**: SVG components in `apps/web/app/components/`, server-rendered (no hydration).
6. **New pages**: wrap with `<AppShell alertCount={await loadActionableAlertCount()}>` so the sidebar and badge stay consistent.
7. **New table read by a page**: `grant select ... to authenticated` **and** a `for select to authenticated` policy. Without both, the page degrades quietly (the Shopee shop name silently rendered as a raw id — migration `20260716250000`) instead of failing loudly.
8. **Exports**: an export route must reuse the page's `build-suggestions.ts`, never recompute. The spreadsheet is the screen by construction — that's the whole point of the shared builder. Sheet helper: `lib/xlsx.ts`.
9. **New Shopee function**: read the token, never renew it (renewal is exclusive to `shopee-sync`), and sign with the shop's own partner app key.
10. **Status**: after significant changes, update `docs/project-status-YYYY-MM-DD.md` and add an entry to `CHANGELOG.md`. Point `README.md`'s "First files to read" and "Current production state" at the new status doc. This is the rule most often skipped — two shipped changes (the 15-item cap and the map popup) had to be back-documented on 2026-07-17 because it was.
