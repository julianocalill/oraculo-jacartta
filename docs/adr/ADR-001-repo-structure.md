# ADR-001: Monorepo With Embedded Vault

## Status

Accepted

## Context

The project must preserve continuity across different Codex accounts, engineers and AI tools. Chat history cannot be treated as durable memory.

## Decision

Use a single monorepo with:

- `apps/web` for the Vercel application
- `supabase` for backend logic and schema
- `packages` for shared logic
- `docs` for technical documentation
- `vault` for Obsidian-compatible project memory

## Consequences

- Architecture and implementation stay close together.
- Context transfer becomes file-based instead of account-based.
- Onboarding a new agent becomes mostly a reading task, not a memory reconstruction task.
