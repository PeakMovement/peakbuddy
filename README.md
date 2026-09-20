# Buddy (peakbuddy)

Clinical health monitoring for Peak Movement clients and practitioners. Canonical host: `https://buddy.peakmovement.co.za`.

This repo is **not** the Peak Movement marketing site (`peakmovement.co.za`).

## Secrets — rotate the leaked anon key

A `.env` file with the live **Supabase anon / publishable JWT** was committed on `main`. It is now untracked (see `.env.example`). **Do not rewrite git history** on this public repo to purge it — that is risky without a coordinated force-push. **Rotate the key instead.**

1. Supabase Dashboard → Project Settings → API → **reset/rotate the anon (publishable) key**.
2. Update the same value in Lovable Cloud secrets and any Cloudflare/Worker env (`SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
3. Copy `.env.example` → `.env` locally. Never commit `.env`.
4. The service-role key was **not** in that tracked file. Still keep it server-only.

## Cron: wearables daily pull

`POST /api/public/hooks/wearables-sync` pulls Oura and Polar (Garmin is push-only). Fail-closed: missing or wrong `CRON_SECRET` → 401.

```bash
curl -fsS -X POST "$BUDDY_APP_BASE_URL/api/public/hooks/wearables-sync" \
  -H "Authorization: Bearer $CRON_SECRET"
# or: -H "x-cron-secret: $CRON_SECRET"
```

Suggested schedule: once daily after midnight SAST (`0 0 * * *` UTC ≈ 02:00 SAST).

In-repo: `.github/workflows/scheduled-hooks.yml` runs that POST when GitHub Actions secrets `BUDDY_APP_BASE_URL` and `CRON_SECRET` are set. This host does **not** use Wrangler cron triggers (Lovable Cloud). See `docs/OPERATIONS.md`.

## Group practices

Practice **owners** see every client (and those clients’ alerts) on the practitioner dashboard. **Members** see only their assigned caseload. Apply `supabase/migrations/20260920120000_practice_owner_rls.sql` on the live database.

## Deploy

Production is **Lovable Cloud**, not a GitHub deploy workflow. After merge to `main`, publish from the Lovable UI (exact clicks in `docs/OPERATIONS.md`).
