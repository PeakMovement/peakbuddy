
# Disconnect from old Supabase, run fully on Lovable Cloud

Two steps. Nothing else.

## Step 1 — Recreate schema on Lovable Cloud

One migration that creates the 7 tables from your schema dump on the Lovable Cloud database (`gkgdqfghvjjaapluxcrz`):
`profiles`, `practices`, `clients`, `check_ins`, `alerts`, `symptom_queries`, `platform_settings`.

Includes the GRANTs and RLS policies Lovable Cloud requires (otherwise the app gets "permission denied" errors). You'll see the SQL and approve before it runs.

## Step 2 — Remove hardcoded old-project URL from code

Six files currently hardcode `https://vzzpmsmtjlhpsrkbzqlh.supabase.co`. I replace each with the env var that already points at Lovable Cloud:

- `src/lib/supabase.ts`
- `src/lib/practitioner-signup.functions.ts`
- `src/lib/clients.functions.ts`
- `src/lib/notify-practitioner.functions.ts`
- `src/routes/api/public/triage-query.ts`
- `scripts/seed-demo.ts`, `scripts/seed-apple.ts`

After this, no code references the old project. The app talks only to Lovable Cloud.

## What this plan does NOT do (on purpose)

- No data migration — Lovable Cloud starts empty; you'll re-register / re-add demo clients yourself.
- No auth provider / email template config — do that in Cloud → Users when ready.
- The old Supabase project is left alone — you can pause/delete it from its own dashboard whenever.

Approve to proceed.
