# Analytics Foundation

## Objective

Build the first operational analytics layer for Oraculo from Olist data.
The product must answer daily decision questions, not just store history.

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

- KPI cards
- revenue over time chart
- channel share
- channel trend
- status funnel
- products ascending
- products declining

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

### 3. Operational feed

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

1. orders ingestion
2. order items ingestion
3. product dimension
4. stock ingestion
5. daily aggregations
6. product intelligence views
7. alert generation

## Product rule

Do not build the final AI layer before the operational data is stable.
The AI only becomes useful after the canonical layer and derived metrics exist.
