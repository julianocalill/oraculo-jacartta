# Investigate Slow Production Page

Use this runbook when `https://oraculo.oliverhome.com.br` feels slow or a Vercel request times out.

## First checks

```bash
curl -sI https://oraculo.oliverhome.com.br/
curl -sI 'https://oraculo.oliverhome.com.br/curva-de-venda?curva=A'
curl -sI 'https://oraculo.oliverhome.com.br/curva-de-estoque?curva=A'
```

Protected routes should return `307` to `/login` without a session.

## Performance boundaries

Do not put these patterns back into server render:

- scanning raw `olist_order_items` for curve pages;
- calling `oraculo_fiscal_metrics` or `oraculo_fiscal_order_item_backfill_progress`;
- calling `oraculo_sku_period_rank_unified` for large periods;
- refreshing channel or curve caches during the page request;
- validating Supabase Auth remotely on every request when the JWT is still valid.

## Expected fast sources

- Home SKU ranking: `oraculo_sku_current_unified`.
- Home rupture card: `oraculo_stock_watchlist_unified`.
- Home channel cache: `oraculo_channel_sales_unified_cache`.
- Curva de Venda: `oraculo_sales_curve()`.
- Curva de Estoque: `oraculo_stock_coverage_curve()`.

## If data looks stale

Refresh caches out of band. Do not refresh them inside the Next.js request path.

```bash
npx supabase db query --linked "select public.refresh_oraculo_sales_curve_cache();"
npx supabase db query --linked "select public.refresh_oraculo_stock_coverage_curve_cache();"
```

