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

### UI/Frontend (as of 2026-07-10)
- **Dark theme** with token-based design: cool near-black background, ouro accent, jewel palette (indigo/violet/cyan/emerald/rose).
- **Sorted tables** on `/skus`: client component with `useMemo` + `useState`, click headers to sort, nulls always last.
- **SVG charts** (server-rendered, no client JS): tax composition donut, margin/ROI gauges, daily revenue area.
- KPI cards feature colored top-rail (2px) with per-metric accent + subtle glow.

### Backend & data (as of 2026-07-10)
- **Fiscal snapshots** (nightly via pg_cron `20 9 * * *` UTC): `fiscal_margin_summary`, `fiscal_sku_margin`, `fiscal_channel_metrics`.
  - Dashboard & `/skus` read snapshots (instant), never call heavy RPCs on request path.
  - All queries tested under `authenticated` role with 8s timeout; none exceed.
- **RLS + auth**: business-data reads via authenticated client (anon key + user JWT); service-role reserved for writes/admin.
- Fiscal layer: Financeiro rules (Jacarta profile, Lucro Real + RET), kit cost expansion by component, per-SKU margin/ROI with tax decomposition.

### Deployment
- Vercel (auto-deploy on main push via `vercel deploy --prod`).
- Supabase project: ref `bbtiipnmdxfxnxbemgjr`, linked to prod.
- Secrets in `.env` (local dev) and Vercel environment variables (production).

## Making changes

1. **CSS**: dark theme tokens live in `apps/web/app/globals.css` (`:root`). Edit token values, not hardcoded colors.
2. **Fiscal logic**: pure functions in `packages/domain/fiscal.js`, tested in `fiscal.test.js`. Run `pnpm test` to verify.
3. **Database**: add migrations in `supabase/migrations/`, apply via `npx supabase db query --linked --file <migration>` (never use `db push`).
4. **Tables**: if you add sorting, use the `SkuTable` pattern (client component with `useState` + `useMemo` + compare function).
5. **Charts**: SVG components in `apps/web/app/components/`, server-rendered (no hydration).
6. **Status**: after significant changes, update `docs/project-status-YYYY-MM-DD.md` and add an entry to `CHANGELOG.md`.
