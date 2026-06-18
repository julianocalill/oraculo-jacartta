# Retomada apos liberar Supabase

## Estado

O projeto `Oraculo` esta pausado porque o Supabase retornou:

```text
402 exceed_egress_quota
```

O usuario vai assinar/ajustar o plano do Supabase ou remover o spend cap.

## Primeiro teste

Depois que o Supabase for liberado, rode:

```bash
cd /Users/julianocalil/oraculo
node --input-type=module -e "import { readFileSync } from 'node:fs'; const envText = readFileSync('.env','utf8'); const env = {}; for (const raw of envText.split(/\r?\n/)) { const line = raw.trim(); if (!line || line.startsWith('#')) continue; const i = line.indexOf('='); if (i === -1) continue; env[line.slice(0,i)] = line.slice(i+1); } const base = env.SUPABASE_URL.endsWith('/') ? env.SUPABASE_URL : env.SUPABASE_URL + '/'; const r = await fetch(new URL('rest/v1/olist_orders?select=id&limit=1', base), { method: 'HEAD', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, Prefer: 'count=exact' } }); console.log(r.status, r.headers.get('content-range'));"
```

Se retornar `402`, o projeto ainda esta bloqueado.

## Proxima sequencia

1. Aplicar:

```text
supabase/migrations/20260616170000_create_olist_analytics_foundation.sql
supabase/migrations/20260618123245_create_oraculo_dashboard_views.sql
```

2. Validar `olist_orders`.

3. Rodar:

```bash
cd /Users/julianocalil/oraculo
ORDER_ITEMS_START_DATE=2026-04-01 ORDER_ITEMS_END_DATE=2026-06-17 node scripts/sync-olist-order-items.js
DIMENSIONS_START_DATE=2026-04-01 DIMENSIONS_END_DATE=2026-06-17 node scripts/sync-olist-dimensions.js
node scripts/snapshot-olist-stock.js
SALES_CACHE_START_DATE=2026-04-01 SALES_CACHE_END_DATE=2026-06-19 node scripts/refresh-oraculo-sales-caches.js
```

4. Criar views/facts para o dashboard.

Esse item ja foi preparado em:

```text
supabase/migrations/20260618123245_create_oraculo_dashboard_views.sql
```

Depois de aplicar a migration, validar as views:

```sql
select * from public.oraculo_daily_sales order by order_date desc limit 10;
select * from public.oraculo_sku_current order by revenue_30d desc limit 10;
select * from public.oraculo_stock_watchlist order by days_until_stockout nulls last limit 20;
```

## Observacao sobre performance

As views de vendas diarias e por canal leem caches:

- `public.oraculo_daily_sales_cache`
- `public.oraculo_channel_sales_cache`

Sempre que uma carga grande de pedidos for feita, rode:

```bash
SALES_CACHE_START_DATE=2026-04-01 SALES_CACHE_END_DATE=2026-06-19 node scripts/refresh-oraculo-sales-caches.js
```

Isso evita timeout do PostgREST ao agregar centenas de milhares de pedidos em tempo real.

## Observacao sobre historico

Em 2026-06-18, os pedidos anteriores a 2026-06-16 tinham contagem, mas muitos nao traziam campos detalhados de total e itens no payload. Por isso, os caches podem mostrar receita zerada nesses dias ate que os pedidos antigos sejam hidratados com detalhe da Olist.

## Arquivos importantes

- `docs/oraculo-master-plan.md`
- `supabase/migrations/20260616170000_create_olist_analytics_foundation.sql`
- `scripts/sync-olist-rolling-window.js`
- `scripts/sync-olist-order-items.js`
- `scripts/sync-olist-dimensions.js`
- `scripts/snapshot-olist-stock.js`
