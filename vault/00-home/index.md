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

## Current status - 2026-07-03

- Production: `https://oraculo.oliverhome.com.br`
- Primary repository: `https://github.com/Grupo-Jacartta/oraculo`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
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
- Light/white dashboard layout is live.
- Official fiscal sale/revenue uses valid outbound NFs, not order creation.
- Fiscal reconciliation is accepted historically: `71.198` valid NFs and `R$ 5.243.715,76` for `2026-06-01` to `2026-06-19`.
- July current-month validation on `2026-07-03`: `7.186` valid NFs, `R$ 688.547,55`, data through `2026-07-03`.
- Dashboard and `/pedidos` default to the current month in `America/Sao_Paulo`.
- Fiscal invoice sync is automatic through Supabase Edge Function `olist-sync-invoices` and crons `oraculo-olist-invoices-15m` / `oraculo-olist-invoices-monthly-deep`.
- Index SKU ranking uses cached `oraculo_sku_current_unified`.
- `Sem canal` in fiscal channel revenue means the NF payload has no channel/integration/marketplace/ecommerce name; July is dominated by NF `394638` for `R$ 178.500,00`.
- NF-to-order linking reaches `99,99%` through `payload.ecommerce.numeroPedidoEcommerce`.
- Fiscal SKU/ROI/margin remain blocked because linked order items cover `41,92%` of fiscal revenue, below the release gate.
- Dashboard fiscal and SKU coverage cards read `oraculo_fiscal_latest_snapshots`.

## Immediate next work

- Continue the controlled backfill of `olist_order_items` only for orders linked to valid fiscal NFs.
- Classify NF `394638` / `Sem canal` business-wise before changing channel mapping.
- Keep `--delay-ms=900 --concurrency=2 --limit=2000 --skip-audit` unless a new rate-limit test proves safer.
- Re-run the fiscal item coverage audit after each batch and write snapshots.
- Create `oraculo_fiscal_sku_sales_by_order_link` only after the coverage gate passes.
- Keep margin, ROI and ROAS disabled until the SKU candidate view is audited.
