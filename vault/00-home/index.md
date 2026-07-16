# Oraculo Home

## Read this first

- [[../01-vision/product-vision]]
- [[../../docs/product/analytics-foundation]]
- [[../03-architecture/system-map]]
- [[../04-data/canonical-data-model]]
- [[../05-integrations/olist]]
- [[../05-integrations/mercadolivre]]
- [[../05-integrations/shopee]]
- [[../07-decisions/decision-log]]

## Current north star

Build an operational intelligence system where Supabase is the canonical backend, Vercel is the product surface, and documentation preserves continuity across people and AI agents.

## Update 2026-07-16 — Mercado Livre: canal analítico completo

- Ingestão horária + tempo quase real (notificações) + histórico de vendas desde 2026-03.
- Duas abas em `/mercado-livre`: Visão geral (ruptura R$/dia com velocidade sobre
  dias-com-estoque, variações, ABC, tendência 120d, trânsito, margem via custo Olist)
  e Sugestão de envio Full (regra Magiic com justificativa por item).
- Detalhes: [[../05-integrations/mercadolivre]] e `docs/project-status-2026-07-16.md`.

## Current status - 2026-07-07

- Production: `https://oraculo.oliverhome.com.br`
- Latest documented Vercel deploy: `dpl_ARv9uGp7C6sF2z6ode69r6cYxyGf`
- Primary repository: `https://github.com/Grupo-Jacartta/oraculo`
- Personal mirror: `https://github.com/julianocalill/oraculo-jacartta`
- App is protected by Supabase Auth.
- User management exists at `/usuarios`.
- Manual operational parameters live at `/parametros`.
- Parameters now cover:
  - channel rates and margin targets;
  - SKU cost/margin overrides;
  - state/UF tax rules for destination internal ICMS, interstate ICMS, FCP, computed DIFAL and computed effective tax rate.
- DIFAL rule: `max(destination internal ICMS - interstate ICMS, 0)`. Effective tax: `interstate ICMS + DIFAL + FCP`.
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
- Fiscal invoice sync is automatic through Supabase Edge Function `olist-sync-invoices` and crons `oraculo-olist-invoices-15m` / `oraculo-olist-invoices-monthly-headers-hourly`.
- July fiscal headers were resynced on `2026-07-07`: `22.698` NFs fetched/upserted; dashboard snapshot after resync has `21.676` valid NFs and `R$ 1.781.726,64`.
- Index SKU ranking uses cached `oraculo_sku_current_unified`.
- Sales curve page `/curva-de-venda` is live in code. It lists simple Olist products with `disponivel > 0` and `tipo <> K`, excludes kits, shows product name, last sale date, stock quantity and curve, groups products into A/B/C by days since last sale, supports curve filters and exports CSV.
- Stock curve page `/curva-de-estoque` is live in code. It classifies products with `disponivel > 0` by estimated months of stock coverage, not last-sale recency, supports curve filters and exports CSV.
- Sales curve now reads cached RPC `oraculo_sales_curve()` backed by `oraculo_sales_curve_cache`; do not reintroduce raw historical aggregation in Next.js render.
- Stock curve now reads cached RPC `oraculo_stock_coverage_curve()` backed by `oraculo_stock_coverage_curve_cache`; do not reintroduce raw historical aggregation in Next.js render.
- Home performance pass is live: no request-time channel cache refresh, rupture reuses `oraculo_stock_watchlist_unified`, order count uses estimated count, and middleware avoids calling Supabase Auth on every request with a still-valid JWT.
- `Sem canal` in fiscal channel revenue means the NF payload has no channel/integration/marketplace/ecommerce name; July is dominated by NF `394638` for `R$ 178.500,00`.
- NF-to-order linking reaches `99,99%` through `payload.ecommerce.numeroPedidoEcommerce`.
- Operational margin/ROI is visible in `/skus` as partial product intelligence. Official fiscal SKU/ROI/margin remains gated until linked order item coverage passes the release gate.
- Dashboard fiscal and SKU coverage cards read `oraculo_fiscal_latest_snapshots`.

## Immediate next work

- Continue the controlled backfill of `olist_order_items` only for orders linked to valid fiscal NFs.
- Classify NF `394638` / `Sem canal` business-wise before changing channel mapping.
- Keep the sales curve clearly treated as operational inventory intelligence, not as official fiscal margin/ROI.
- Keep the stock curve based on coverage months from average sales: stock / (daily average * 30).
- Keep curve and home pages on cached Supabase sources; request-time scans of raw order history are not acceptable for production.
- Keep `--delay-ms=900 --concurrency=2 --limit=2000 --skip-audit` unless a new rate-limit test proves safer.
- Re-run the fiscal item coverage audit after each batch and write snapshots.
- Create `oraculo_fiscal_sku_sales_by_order_link` only after the coverage gate passes.
- Keep official fiscal margin, ROI and ROAS gated until the SKU candidate view is audited. Operational `/skus` margin/ROI can stay visible with partial-label copy.
