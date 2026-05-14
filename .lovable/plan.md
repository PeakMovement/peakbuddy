## Goal

Create three ready-to-demo logins so you can show investors every portal without signing anyone up live.

## Demo credentials (defaults — say if you want different ones)

- **Super admin** — email `admin@demo.com` / password `Demo1234!`
- **Practitioner** — email `practitioner@demo.com` / password `Demo1234!` (onboarding pre-completed, practice name "Demo Wellness")
- **Client** — login code `DEMO123`, name "Demo Client", attached to the demo practitioner, with one sample check-in so the dashboard isn't empty

## Steps

1. You add your Supabase **service role key** as a secret named `SEED_SERVICE_ROLE_KEY`. (Found in Supabase dashboard → Project Settings → API → `service_role`.)
2. I write a one-off Node script `scripts/seed-demo.ts` that uses the service role key to:
   - Create the two auth users (admin + practitioner) with confirmed emails so they can log in immediately.
   - Insert their `profiles` rows with `role = 'super_admin'` and `role = 'practitioner'`.
   - Insert a `practices` row for the practitioner with `onboarding_complete = true`.
   - Insert a `clients` row with `login_code = 'DEMO123'` linked to the practitioner.
   - Insert one sample check-in for the client.
3. I run the script once from the sandbox. You then log in via `/admin/login`, `/practitioner/login`, and `/client/login` to verify all three portals work.
4. The script is idempotent — safe to re-run; it'll skip rows that already exist.

## Notes

- The service role key never reaches the browser — it's only read inside the seed script.
- No production code changes; only a new file under `scripts/`.
- If you'd rather not share the service role key, the alternative is for me to generate a SQL snippet you paste into the Supabase SQL editor yourself.
