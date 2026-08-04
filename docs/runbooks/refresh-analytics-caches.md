# Refresh Analytics Caches

Use this runbook after large stock, product or sales reloads, or when `/curva-de-venda` or `/curva-de-estoque` look stale.

## Sources

- Sales curve page: `oraculo_sales_curve()` backed by `oraculo_sales_curve_cache`.
- Stock coverage curve page: `oraculo_stock_coverage_curve()` backed by `oraculo_stock_coverage_curve_cache`.
- SKU 30-day figures **and** the rupture watchlist: `refresh_oraculo_unified_sku_cache()` backed by `oraculo_sku_current_unified_cache` + `oraculo_stock_watchlist_unified_cache`. Feeds `/skus`, `/alertas`, the home cards and `days_until_stockout`.

## Manual refresh

Run against the linked Supabase project:

```bash
npx supabase db query --linked "select public.refresh_oraculo_sales_curve_cache();"
npx supabase db query --linked "select public.refresh_oraculo_stock_coverage_curve_cache();"
```

### ⚠️ The unified SKU cache is the exception — do NOT run it this way

`refresh_oraculo_unified_sku_cache()` takes ~5 minutes and **exceeds the API
gateway's 2-minute statement timeout**. Calling it through `supabase db query`
fails with `57014` and, because both inserts share one transaction, rolls the
whole function back — leaving the cache exactly as stale as before, with no
partial progress.

It is scheduled as `oraculo-unified-sku-cache` (`30 * * * *`, created
2026-08-03). To force a run outside the schedule, go through `pg_cron` and
remove the temporary job afterwards:

```sql
select cron.schedule('unified-sku-cache-boot', '* * * * *',
  $job$ set local statement_timeout = '20min';
        select public.refresh_oraculo_unified_sku_cache(); $job$);
-- wait for it to appear as 'succeeded' in cron.job_run_details, then:
select cron.unschedule('unified-sku-cache-boot');
```

**Unschedule the boot job as soon as it starts running.** `pg_cron` does not
guard against overlapping runs, and a job firing every minute against a
5-minute function will pile up concurrent writes to the same cache tables.

Check progress with:

```sql
select jobid, status, start_time, end_time, return_message
from cron.job_run_details where jobid in (
  select jobid from cron.job where jobname like '%unified-sku%')
order by start_time desc limit 5;
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

For the unified SKU cache, the validation that actually matters is **age**, not
count — it failed silently for 45 days by simply never being refreshed:

```sql
select max(refreshed_at) from public.oraculo_sku_current_unified_cache;
```

If it is more than ~2 hours old, the hourly job is not running. Reference from
the 2026-08-03 repopulation: 3.454 SKUs, 973 with sales in the window,
R$ 12,0 mi of 30-day revenue, 170 SKUs within 15 days of stockout. Before that
run the same table reported 329 SKUs with sales, R$ 571 k of revenue and 5
rupture alerts — the shape of a frozen cache is *plausible but small numbers*,
which is why nobody noticed.

