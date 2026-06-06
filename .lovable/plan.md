## What’s happening

The signup succeeds in creating the Cloud user, then a database trigger auto-creates their profile as a regular `client`. Immediately after that, the practitioner signup backend tries to update that same profile to `practitioner`.

The role-protection trigger is still blocking that update, so the form shows: `Not authorized to change role`.

There is also now a fresh partial account for `justin15muller@gmail.com`: the Cloud user exists and the profile exists, but its role is still `client` and profession is empty.

## Fix plan

1. Update the role-protection trigger to reliably detect trusted backend writes using the built-in Cloud role helper instead of only checking one request setting.
2. Repair the partial `justin15muller@gmail.com` account by setting the existing profile to:
   - role: practitioner
   - profession: Physiotherapist
   - full name: Justin Muller
3. Add a small guard in the practitioner signup backend so if the profile already exists as `client`, it can finish registration cleanly instead of leaving another partial account.
4. Verify the trigger definition and the repaired profile in the database after the migration runs.

## Technical details

- Current trigger: `public.prevent_role_escalation()`
- Failing operation: `registerPractitioner()` upserts `public.profiles.role = 'practitioner'`
- Root cause: signup creates a `profiles` row first via `handle_new_user()`, then role change happens as an update and trips the role-escalation trigger.