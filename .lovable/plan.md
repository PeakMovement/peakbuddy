## Problem

Practitioner signup shows **"Invalid API key"** after submitting the form. The auth user is actually created successfully, but the follow-up server function that writes the `profiles` and `practices` rows fails — and its error string ("Invalid API key" from Supabase) is shown verbatim under the form. Every failed attempt also leaves an orphan auth user, so retrying the same email then shows "Email already registered."

## Root cause

`src/lib/practitioner-signup.functions.ts` builds its own admin Supabase client from `process.env.SEED_SERVICE_ROLE_KEY`. That secret is stale / not a valid service-role key for this project anymore. The integration-managed `supabaseAdmin` (which uses `SUPABASE_SERVICE_ROLE_KEY`) works correctly — we already proved this when we fixed the Yves access gate.

## Fix

Edit only `src/lib/practitioner-signup.functions.ts`:

1. **`registerPractitioner`** — replace the `createClient(SUPABASE_URL, SEED_SERVICE_ROLE_KEY, …)` construction with a dynamic import of the integration-managed admin client inside the handler:
   ```ts
   const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
   ```
   Use `supabaseAdmin` for the existing `profiles` upsert, the `practices` lookup/insert, and the `platform_settings` webhook lookup. No other logic changes.

2. **`checkSignupReady`** — stop probing `SEED_SERVICE_ROLE_KEY`. The signup form's preflight should just return `{ ok: true }` (the integration guarantees `SUPABASE_SERVICE_ROLE_KEY` is present whenever Cloud is connected). This also unblocks the form on environments where the legacy seed key was never set.

3. Leave `SEED_SERVICE_ROLE_KEY` alone elsewhere — `scripts/seed-*.ts` still reference it, and those are run manually outside the app.

## Out of scope

- No client-side changes to `src/routes/practitioner.signup.tsx` (it already surfaces the serverFn's error string; once the underlying call succeeds, the UI works).
- No DB migrations.
- Orphan auth users from previous failed attempts are not cleaned up automatically. If the user wants to retry with the same email, they should use a different email or we can clean those rows up afterward via SQL — say the word and I'll do it as a follow-up.

## Verification

1. Submit the signup form with a fresh email → expect success screen ("Check your email").
2. Confirm a row exists in `profiles` with `role='practitioner'` and a row in `practices` with `is_approved=false` for that user.
3. Existing practitioner login flow unaffected.
