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
| `/api/public/hooks/whatsapp-worker`            | every minute. Also sends the practitioner morning check-in between 08:00 and 10:00 SAST on open weekdays |

### Practitioner morning check-in

No new cron URL. The existing minute job (`whatsapp-worker`, scheduled in `drizzle/migrations/0020_schedule_all_hooks.sql`) calls `runMorningCheckins` after the other practitioner jobs.

Who gets it: a practitioner with at least one current patient (the same "current" bucket as the WhatsApp caseload summary: a check-in in the last 60 days, joined in the last 30 days, or an open alert). Weekends are skipped (`OPEN_WEEKDAYS` in `src/lib/whatsapp/clinic-hours.ts`, Saturday already closed). Dates listed in `PUBLIC_HOLIDAYS` are skipped too; that set is empty until someone fills it in. Each practitioner is sent at most once per South African date (`practitioner_morning_checkins.last_sent_on`). No row means the note is on. "Not today" skips that reply only. "Stop morning check-ins" opts out; "start morning check-ins" turns it back on.

Inside the practitioner's 24 hour WhatsApp window the note is an interactive message. Outside it, Buddy sends the template below. If `WHATSAPP_MORNING_CHECKIN_TEMPLATE` is unset, that practitioner is skipped and a warning is logged. The job does not throw, and this repo does not submit the template to Meta.

#### Meta template (create in WhatsApp Manager; do not expect the app to submit it)

| | |
| --- | --- |
| Suggested name | `buddy_morning_checkin` (the live name is whatever you put in `WHATSAPP_MORNING_CHECKIN_TEMPLATE`) |
| Language | `en`, unless `WHATSAPP_MORNING_CHECKIN_TEMPLATE_LANG` is set |
| Category | Utility |
| Header | none |
| Body | `Good morning {{1}}. Would you like an update on your patients, or should reception check in with anyone?` |
| Body variable `{{1}}` | Practitioner first name |
| Footer | none |
| Buttons | Quick reply, in this order. Titles are fixed on the template. Payloads are set on send and must stay in this order. |

| # | Button title | Payload Buddy sends |
| --- | --- | --- |
| 1 | Patient update | `prac_morn_update` |
| 2 | Reception check-in | `prac_morn_reception` |
| 3 | Not today | `prac_morn_skip` |

"Patient update" replies with the existing caseload summary (who needs a look, who is quiet, red flags). "Reception check-in" asks for one or more patient names and confirms before the errand is passed to reception. Nothing is sent to a patient from that button.

#### Lovable publish

1. Merge this branch to `main` (or Sync / Pull so the Lovable project has the commit).
2. Apply `drizzle/migrations/0037_morning_checkin.sql` on the live database. Schema changes go through `drizzle/migrations/` only. Do not add this file under `supabase/migrations/`.
3. In Lovable Cloud env, set `WHATSAPP_MORNING_CHECKIN_TEMPLATE` only after Meta has approved the template above. Optional: `WHATSAPP_MORNING_CHECKIN_TEMPLATE_LANG` (default `en`). Leave the name unset until then: practitioners outside the 24 hour window are skipped and logged, and practitioners inside the window still get the buttons.
4. Publish (or Update / Ship) from the Lovable UI. There is no deploy workflow in this repo.
5. No new scheduler. The minute `whatsapp-worker` hook already runs.

## Apply training schedule + restaurant partners

File: `supabase/migrations/20260920150000_training_schedule_and_restaurant_partners.sql`

Same Lovable Cloud → Supabase pending migrations (or `supabase db push`). Enables `training_sessions`, `restaurant_partners`, and extra columns on `rewards`. How to load Justin’s restaurant list: `docs/CHECKIN_REWARDS_AND_TRAINING_SCHEDULE.md`.

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
