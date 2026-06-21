# Context Handoff

Before handing work to another agent or account:

1. Update the relevant docs.
2. Record any structural decision in an ADR.
3. Write the next unresolved question in the relevant product or architecture note.
4. Ensure file paths, URLs and environment variable names are explicit.

Never rely on "the next agent will infer it from chat".

## Current handoff - 2026-06-21

Production:

- URL: `https://oraculo.oliverhome.com.br`
- Repo: `https://github.com/julianocalill/oraculo-jacartta`
- Latest documented focus: reliable ROI/margin/product intelligence for the operations director.

Implemented recently:

- Supabase Auth login and `/usuarios` user management.
- `/parametros` with manual channel, SKU and UF fiscal parameters.
- `oraculo_state_tax_params` for ICMS/FCP/DIFAL/effective tax by UF/source/operation/vigency.
- Olist hourly incremental sync via Supabase `pg_cron`.
- Derived metrics/cache sync via Supabase `pg_cron`.
- NF cache moved to direct Postgres cron.
- Stock/product sync every 6 hours.
- Mobile responsive CSS for app navigation, dashboard, tables and forms.
- Vercel deploys to production domain.

Known technical caveats:

- Some historical windows have `olist_orders` but no `olist_order_items`; SKU rankings will be incomplete there.
- `dataFaturamento` is incomplete in imported Olist payloads; operational KPIs use order date/status until fiscal coverage is proven.
- UF tax parameters exist but are not yet applied in ROI/margin formulas.
- Stock sync is not hourly because the current Olist stock flow scans products broadly.

Recommended next work:

1. Build a sync status screen showing latest `olist_sync_runs`, stock runs, cron status and `pg_net` failures.
2. Backfill historical `olist_order_items` in controlled small windows.
3. Connect destination UF to margin/ROI calculation.
4. Add executive alerts for low margin, rupture and no-sale products.
