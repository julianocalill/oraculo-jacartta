# Oraculo

Monorepo base for the Oraculo product.

## Purpose

Oraculo is an operations and intelligence platform built around a canonical data layer in Supabase/Postgres, with a web application deployed on Vercel and documentation maintained in Obsidian-friendly markdown.

The key design constraint is portability: another Codex account, another engineer, or another AI agent must be able to enter this repository and recover project context from files alone.

## Repo map

```text
oraculo/
  apps/
    web/              # Next.js app for Vercel
  packages/
    config/           # shared config and constants
    domain/           # domain types and core entities
  supabase/
    functions/        # Edge Functions
    migrations/       # SQL migrations
  docs/
    adr/              # architecture decision records
    runbooks/         # operational procedures
    product/          # product-facing docs
    prompts/          # AI playbooks
  vault/
    ...               # Obsidian knowledge base
```

## First files to read

1. [docs/project-context.md](docs/project-context.md)
2. [docs/engineering-playbook.md](docs/engineering-playbook.md)
3. [docs/deployment-map.md](docs/deployment-map.md)
4. [docs/oraculo-master-plan.md](docs/oraculo-master-plan.md)
5. [docs/runbooks/resume-after-supabase-upgrade.md](docs/runbooks/resume-after-supabase-upgrade.md)
6. [vault/00-home/index.md](vault/00-home/index.md)

## Tooling choices

- `pnpm` workspaces
- `Next.js` for the web app on Vercel
- `Supabase` for database, auth, storage and Edge Functions
- `Obsidian` vault inside the repository for portable project memory

## Runtime configuration

Local development reads secrets from the repository root `.env` file. The web app also falls back to that file when `process.env` is not already populated.

Required variables for the current dashboard:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_REF`
- `OLIST_API_CLIENT_ID`
- `OLIST_API_CLIENT_SECRET`
- `OLIST_API_TOKEN_URL`
- `OLIST_OAUTH_REDIRECT_URI`
- `OLIST_OAUTH_STATE_SECRET`
- `OLIST_API_BASE_URL`
- `OLIST_SYNC_JOB_SECRET`
- `OLIST_API_AUTH_HEADER`
- `OLIST_API_AUTH_PREFIX`
- `OLIST_STOCK_ENDPOINT`

## Portability rule

Any important decision, schema change, workflow change, or agent convention must be reflected in repository files. Chat history is never treated as the source of truth.
