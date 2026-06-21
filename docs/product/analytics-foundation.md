# Analytics Foundation

## Objective

Build the operational analytics layer for Oraculo from Olist and marketplace data.
The product must answer daily decision questions, not just store history.

As of `2026-06-21`, the first analytics foundation is live in production and the next step is making ROI/margin/product alerts reliable.

## Visual direction

The reference system shown in the screenshots has these traits:

- dense operational dashboard
- dark theme
- strong KPI strip at the top
- period filters and projection controls
- channel comparison
- SKU ranking tables
- alerts for up/down movement, rupture and stock risk
- product-centric navigation

Oraculo should match that density, but keep the system simpler in the first release.

## First product surfaces

### 1. Analytics overview

Purpose:

- show current health of the operation
- summarize revenue, ticket, orders, cancellations and stock risk
- compare period against previous period

Required blocks:

- KPI cards using canonical operational definitions
- revenue over time chart
- channel/source revenue
- status funnel
- top SKUs by revenue and quantity
- stock rupture/no-sale watchlist

### 2. Product intelligence

Purpose:

- treat product as an asset
- understand performance, trend, rupture and stock position

Required blocks:

- SKU table
- ABC / XYZ classification
- revenue, units, ticket
- last sale date
- stock, stock value, rupture
- trend sparkline
- movement vs baseline
- margin/ROI status once cost, tax and fee parameters are valid

### 3. Parameters

Purpose:

- capture data that does not come reliably from Olist/Shopee APIs;
- keep margin/ROI assumptions explicit and auditable.

Current blocks:

- channel parameters: tax, marketplace fee, payment fee, freight subsidy, packaging, target/minimum margin;
- SKU overrides: unit cost, target/minimum margin;
- state tax parameters: ICMS, FCP, DIFAL, effective tax rate, source, operation and validity.

### 4. Operational feed

Purpose:

- expose what changed recently
- help the team act on anomalies

Required blocks:

- sync runs
- new alerts
- product changes
- stock changes
- order status changes

## Canonical data needed first

### Olist

- `olist_orders`
- `olist_order_items`
- `olist_stock_items`
- `olist_products`
- `olist_oauth_tokens`
- sync run tables

### Derived tables

- daily revenue
- daily orders
- channel revenue
- SKU performance
- stock risk
- rupture risk
- alert queue

### Parameters

- `oraculo_margin_channel_params`
- `oraculo_margin_sku_params`
- `oraculo_state_tax_params`

## Core metrics

- faturamento bruto
- faturamento efetivo
- vendas
- unidades
- ticket medio
- cancelados
- frete
- taxa
- estoque zerado
- estoque em risco
- ultimo dia de venda por SKU
- tendencia por canal
- variacao contra periodo anterior

## Data model requirement

The first layer must preserve raw payloads in JSONB while also extracting the fields needed for dashboards.
This allows us to model more later without reimporting the source.

## Implementation order

1. orders ingestion - active
2. order items ingestion - active for current/recent windows, historical gaps remain
3. product dimension - active
4. stock ingestion - active every 6 hours
5. daily aggregations - active
6. product intelligence views - foundation active
7. parameter UI - active for channel, SKU and UF fiscal rules
8. alert generation - next milestone

## Product rule

Do not build the final AI layer before the operational data is stable.
The AI only becomes useful after the canonical layer and derived metrics exist.
