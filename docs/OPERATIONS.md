# Buddy operations

## Rotate secrets (do this; do not rewrite git history)

`.env` was tracked on `main` with the live Supabase **anon/publishable** JWT (project `gkgdqfghvjjaapluxcrz`). Untracking does not remove it from git history. **Do not run `git filter-repo` / BFG on this public repo** unless Justin is present and every clone is coordinated.

**Rotate now:**

1. [Supabase API settings](https://supabase.com/dashboard) → rotate the anon/publishable key.
2. Paste the new value into Lovable Cloud env and Cloudflare/Worker secrets:
   - `SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Local: `cp .env.example .env` and fill dummies/real values off-git.
4. Service role was not in the tracked `.env`. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. `SEED_SERVICE_ROLE_KEY` is local seed scripts only.

## Schedule `POST /api/public/hooks/wearables-sync`

The Worker has **no Wrangler `triggers.crons`** — Lovable Cloud does not pick up `wrangler.jsonc` cron. Use an external scheduler.

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Method         | `POST`                                                                                               |
| URL            | `https://buddy.peakmovement.co.za/api/public/hooks/wearables-sync` (or current `BUDDY_APP_BASE_URL`) |
| Auth           | `Authorization: Bearer $CRON_SECRET` or header `x-cron-secret`                                       |
| Cadence        | Daily after midnight SAST (`0 0 * * *` UTC)                                                          |
| Body           | none                                                                                                 |
| Missing secret | **401** (fail closed)                                                                                |

```bash
curl -fsS -X POST "$BUDDY_APP_BASE_URL/api/public/hooks/wearables-sync" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### GitHub Actions (in-repo)

Workflow: `.github/workflows/scheduled-hooks.yml`.

Add repository secrets:

- `BUDDY_APP_BASE_URL` — e.g. `https://buddy.peakmovement.co.za` (no trailing slash)
- `CRON_SECRET` — same value as the Worker env

If either secret is empty the job skips (exit 0) rather than calling an open endpoint.

### Other CRON_SECRET hooks

Same auth. Wire these in Cloudflare/Lovable cron or extra Actions jobs if needed:

| Path                                           | Cadence (suggested) |
| ---------------------------------------------- | ------------------- |
| `/api/public/hooks/checkin-reminders`          | every 5 minutes     |
| `/api/public/hooks/nightly-risk-analysis`      | nightly             |
| `/api/public/hooks/nightly-pattern-detection`  | nightly             |
| `/api/public/hooks/weekly-practitioner-digest` | weekly              |
| `/api/public/hooks/onboarding-library-nudge`   | daily               |
| `/api/public/hooks/wearables-sync`             | daily               |

## Apply the group-practice RLS migration

File: `supabase/migrations/20260920120000_practice_owner_rls.sql`

Until this is applied on the live Supabase project, dashboard/alerts still work via **server functions** (service role). RLS is the extra layer so owner updates (edit client, mark alert read) succeed on the browser client too.

Lovable: **Cloud → Supabase → run pending migrations**, or `supabase db push` with a privileged connection.

## Publish to production (Lovable Cloud)

There is **no** in-repo deploy GitHub Action and no `wrangler deploy` in CI. Publishing is the Lovable UI:

1. Open the **peakbuddy** project in [Lovable](https://lovable.dev).
2. Ensure the workspace is on git `main` (or use **Sync / Pull** so it has the merged commit).
3. Click **Publish** (or **Update** / **Ship** if the project is already live).
4. Confirm Worker env still has `CRON_SECRET`, `GARMIN_CONSUMER_SECRET`, `OURA_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and set `BUDDY_APP_BASE_URL` / `VITE_BUDDY_APP_BASE_URL` to `https://buddy.peakmovement.co.za`.
5. Add that origin to Supabase Auth redirect URLs, OAuth apps, and `ALLOWED_ORIGINS`.

Do not publish the Peak Movement **marketing** site from this repo.
