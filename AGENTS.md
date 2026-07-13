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

### UI/Frontend (as of 2026-07-12)
- **Dark theme** with token-based design: cool near-black background, ouro accent, jewel palette (indigo/violet/cyan/emerald/rose).
- **Persistent shell**: `AppShell` + `SidebarNav` (client, `usePathname`) on all 10 authenticated pages. Exact global alert badge via `lib/alert-count.ts`.
- **Metric cards**: shared `MetricCard` component (in `app/page.tsx`) with sparkline + variation chip, used across the app — not a one-off dashboard element. Delta color inverts for cost/taxes (rising is bad).
- **Sorted tables**: `/skus` has a dedicated client component (`useMemo` + `useState`); everywhere else uses the generic `app/components/sortable-table.tsx` (serializable cells: text/sort/href/badge/subtitle). Click headers to sort, click again to reverse, nulls always last.
- **SVG charts** (server-rendered, no client JS): tax composition donut, margin/ROI gauges, daily revenue area with dashed average line.
- **Visual identity**: `BrandMark` component (SVG inline, same source as favicon) — see `docs/brand-oraculo.md`.
- **Pricing calculator** (`/calculadora`): standalone rules, does not touch the fiscal engine. Marketplace presets are data, not logic — see `apps/web/app/calculadora/calculator.tsx`.

### Backend & data (as of 2026-07-12)
- **Fiscal snapshots** (hourly via pg_cron, `**:15`, 14-day retention — migration `20260710190000`): `fiscal_margin_summary`, `fiscal_sku_margin`, `fiscal_channel_metrics`.
  - Current-month window (default) reads snapshots (instant); a custom date window computes live via RPC with try/catch degradation — never silently shows the wrong month.
  - Snapshot **history** (not just latest) is readable by `authenticated` (migration `20260712100000`) to power card sparklines.
  - All queries tested under `authenticated` role with 8s timeout; none exceed.
- **RLS + auth**: business-data reads via authenticated client (anon key + user JWT); service-role reserved for writes/admin.
- Fiscal layer: Financeiro rules (Jacarta profile, Lucro Real + RET), kit cost expansion by component, per-SKU margin/ROI with tax decomposition.

### Deployment
- Vercel (auto-deploy on main push via `vercel deploy --prod`).
- Supabase project: ref `bbtiipnmdxfxnxbemgjr`, linked to prod.
- Secrets in `.env` (local dev) and Vercel environment variables (production).

## Making changes

1. **CSS**: dark theme tokens live in `apps/web/app/globals.css` (`:root`). Edit token values, not hardcoded colors.
2. **Fiscal logic**: pure functions in `packages/domain/fiscal.js`, tested in `fiscal.test.js`. Run `pnpm test` to verify. Never let the standalone calculadora (`/calculadora`) read from or write to this layer — it's intentionally independent.
3. **Database**: add migrations in `supabase/migrations/`, apply via `npx supabase db query --linked --file <migration>` (never use `db push`).
4. **Tables**: prefer `app/components/sortable-table.tsx` (generic, serializable cells) for new sortable tables; `/skus` keeps its dedicated component for historical reasons.
5. **Charts**: SVG components in `apps/web/app/components/`, server-rendered (no hydration).
6. **New pages**: wrap with `<AppShell alertCount={await loadActionableAlertCount()}>` so the sidebar and badge stay consistent.
7. **Status**: after significant changes, update `docs/project-status-YYYY-MM-DD.md` and add an entry to `CHANGELOG.md`. Point `README.md`'s "First files to read" and "Current production state" at the new status doc.
