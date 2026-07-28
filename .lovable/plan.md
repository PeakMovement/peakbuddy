# Restore the Demo Client login

## What you asked
Demo client login details — they are (from `scripts/seed-demo.ts`):

- **URL:** `/client/login`
- **Email:** `client@demo.com`
- **Password:** `Demo1234!`
- **Login code:** `1234`

## Problem found
The credentials **won't work right now**. The auth user `client@demo.com` still exists, but its row in `public.clients` is gone (deleted in an earlier cleanup). The login flow authenticates, then fails with "No client record found for this account. Contact your practitioner."

(Note: `practitioner@demo.com` and `admin@demo.com` from the seed script no longer exist in auth either — only the client auth user survives. This plan restores just the client login you asked about.)

## Fix
1. **Migration** — insert a fresh `public.clients` row:
   - `full_name`: "Demo Client"
   - `email`: `client@demo.com`
   - `login_code`: `1234`
   - `auth_user_id`: bound to the existing `client@demo.com` auth user (looked up by email from `auth.users`)
   - `practitioner_id`: attached to the **Peak Movement** practitioner (`peakmvement@gmail.com`) — say the word if you'd rather it sit under the Asad Test Account practitioner
   - `primary_complaint`, `notes`, `check_in_frequency: daily`, `popia_accepted: true` (mirroring the seed script)
2. **Sample check-in** — insert one demo check-in row so the client dashboard isn't empty (same values as the seed script: pain 4, sleep 7, stress 5, energy 6).
3. **Verify** — drive Playwright through `/client/login` with `client@demo.com` / `Demo1234!` and confirm it lands on `/client/app/checkin`.

## Technical details
- Plain data insert via migration; no schema changes, no RLS changes.
- No application code is touched.
- If you later want the full demo trio back (practitioner + admin logins too), that needs the seed script re-run with the service key — say so and I'll plan that separately.
