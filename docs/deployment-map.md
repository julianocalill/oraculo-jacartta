# Deployment Map

## Web

- Platform: `Vercel`
- App path: `apps/web`
- Framework: `Next.js`
- Data access: server-side Supabase client using `SUPABASE_SERVICE_ROLE_KEY`

## Backend

- Platform: `Supabase`
- Backend path: `supabase`
- Responsibilities:
  - canonical database
  - edge functions
  - auth and storage when needed

## Portability

Deployment knowledge must not live only in dashboards.

Keep the following documented in the repo:

- environment variables
- domain setup
- webhook URLs
- callback URLs
- cron ownership
- rollback notes
- local fallback env loading for `apps/web`
