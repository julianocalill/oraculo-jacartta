# Refresh Analytics Caches

Use this runbook after large stock, product or sales reloads, or when `/curva-de-venda` or `/curva-de-estoque` look stale.

## Sources

- Sales curve page: `oraculo_sales_curve()` backed by `oraculo_sales_curve_cache`.
- Stock coverage curve page: `oraculo_stock_coverage_curve()` backed by `oraculo_stock_coverage_curve_cache`.

## Manual refresh

Run against the linked Supabase project:

```bash
npx supabase db query --linked "select public.refresh_oraculo_sales_curve_cache();"
npx supabase db query --linked "select public.refresh_oraculo_stock_coverage_curve_cache();"
```

## Validation

```bash
npx supabase db query --linked --output json "select count(*) from public.oraculo_sales_curve();"
npx supabase db query --linked --output json "select count(*) from public.oraculo_stock_coverage_curve();"
```

Expected reference counts from the 2026-07-06 validation:

- `oraculo_sales_curve()`: `446` simple stocked products.
- `oraculo_stock_coverage_curve()`: `959` stocked products.

Counts can change after stock/product syncs. A sudden zero result usually means a source load or cache refresh failed.

