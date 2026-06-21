# Oraculo Home

## Read this first

- [[../01-vision/product-vision]]
- [[../../docs/product/analytics-foundation]]
- [[../03-architecture/system-map]]
- [[../04-data/canonical-data-model]]
- [[../05-integrations/olist]]
- [[../07-decisions/decision-log]]

## Current north star

Build an operational intelligence system where Supabase is the canonical backend, Vercel is the product surface, and documentation preserves continuity across people and AI agents.

## Current status - 2026-06-21

- Production: `https://oraculo.oliverhome.com.br`
- Repository: `https://github.com/julianocalill/oraculo-jacartta`
- App is protected by Supabase Auth.
- User management exists at `/usuarios`.
- Manual operational parameters live at `/parametros`.
- Parameters now cover:
  - channel rates and margin targets;
  - SKU cost/margin overrides;
  - state/UF tax rules for ICMS, FCP, DIFAL and effective tax rate.
- Olist sync is Supabase-first:
  - orders hourly;
  - derived metrics hourly;
  - NF cache hourly in Postgres;
  - stock/products every 6 hours.
- Shopee Donacor data is read-only.
- Mobile responsive layout is live.

## Immediate next work

- Backfill missing `olist_order_items` for historical periods with orders but no item detail.
- Apply UF tax parameters to margin/ROI calculations once destination UF is reliable.
- Build sync status/monitoring UI.
- Convert margin/ROI from foundation to executive-ready alerts.
