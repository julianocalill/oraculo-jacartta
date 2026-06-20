# Project Context

## Product intent

Oraculo is an operational intelligence system for commerce operations.

The platform started with Olist as the first integration source and now also stores read-only Shopee Donacor data. Supabase/Postgres is the canonical layer; the web product reads derived and cached metrics from that layer.

The current product direction is practical executive intelligence for the operations director:

- ROI and margin by product
- product sell-through and non-sell-through curves
- stock rupture and days without sale
- revenue and quantity by channel/SKU
- configurable margin alerts in the frontend

## Architectural position

- `Supabase` is the operational backend and data core.
- `Vercel` hosts the user-facing product.
- `GitHub` stores the repository and drives Vercel deploys.
- `Obsidian` can store durable project memory, but repository docs are the source of truth.
- `AI agents` assist architecture, coding, review and documentation, but repository files remain the source of truth.

## Current state on 2026-06-20

- Next.js web app exists in `apps/web`.
- Supabase migrations and Edge Functions exist in `supabase`.
- Olist OAuth is connected and tokens are stored in Supabase.
- Olist orders, items, products and stock tables exist.
- Shopee Donacor orders/items are imported read-only. The system must never alter Shopee data.
- Multi-channel Olist/Shopee views exist.
- Dashboard now reads cached channel metrics instead of recalculating heavy views directly.
- A metric contract was created in `docs/metric-contract.md`.
- Audit tooling was added in `scripts/audit-oraculo-metrics.js`.
- Supabase Auth now protects the app, with `/login` and admin user control in `/usuarios`.
- The main known issue is semantic: the current Olist operational revenue is reliable by order status/date, but strict fiscal `dataFaturamento` coverage is incomplete in the imported base.

## Working rule

Anyone joining the project must recover context from the repository without requiring prior chat access.

That means:

- every important decision gets documented
- every integration gets a runbook
- every data contract gets written down
- every architecture change gets an ADR
