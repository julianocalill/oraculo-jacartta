# Project Context

## Product intent

Oraculo is an operational intelligence system for commerce operations.

The platform starts with Olist as the first integration source, stores data in Supabase/Postgres as the canonical layer, and later enriches that layer with marketplace and operational signals from other channels.

## Architectural position

- `Supabase` is the operational backend and data core.
- `Vercel` hosts the user-facing product.
- `Obsidian` stores durable project memory.
- `AI agents` assist architecture, coding, review and documentation, but repository files remain the source of truth.

## Working rule

Anyone joining the project must recover context from the repository without requiring prior chat access.

That means:

- every important decision gets documented
- every integration gets a runbook
- every data contract gets written down
- every architecture change gets an ADR
