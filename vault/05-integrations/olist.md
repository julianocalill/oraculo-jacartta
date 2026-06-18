# Olist Integration

## Role

First source system for:

- products
- stock
- orders

## Current note

Existing implementation work lives outside this monorepo at:

- `/Users/julianocalil/projetos/07-olist`

That implementation should be migrated into this monorepo incrementally, preserving:

- oauth callback flow
- refresh token handling
- rate-limit strategy
- sync run logging

## First-layer scope

The first canonical layer for Oraculo is:

- `olist_stock_items` for product and inventory snapshot
- `olist_orders` for commercial history and revenue analysis
- `olist_oauth_tokens` for API renewal
- sync-run tables for observability

`olist-sync-orders` is the next required feed for dashboards of faturamento, ticket médio, cancelamentos and canal trend.
