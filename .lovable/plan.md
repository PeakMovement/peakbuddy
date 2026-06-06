## Problem

Two bugs combine to make the super-admin "Yves off for Justin Muller" click look ineffective on the client side:

1. **Admin toggle isn't verified after write.** `src/routes/admin.app.practitioner.$practitionerId.tsx` (lines 226–236) calls `supabase.from("practices").update(...)` from the browser without `.select()`, then optimistically calls `onChange`. If RLS or anything else makes the update affect 0 rows, no error is thrown and the UI shows "Off" while the DB still reads `true`. Current DB confirms this: `practices.yves_enabled = true` for Justin Muller despite the user's click.

2. **Client app can't see the practice-level flag.** The `practices` RLS policy is `(auth.uid() = practitioner_id) OR is_super_admin(auth.uid())`. Clients are neither, so the query in `src/routes/client.app.yves.tsx` (lines 107–119) returns `data: null` and `setPracticeYvesEnabled(true)` defaults on. Even when the practice flag is correctly `false`, the client UI still shows Yves as enabled. (The server-side `/api/public/triage-query` gate would 403 a submit, but the UI doesn't reflect the block proactively.)

## Fix

### A. Make the admin write authoritative (`src/routes/admin.app.practitioner.$practitionerId.tsx`)

In `YvesAccessRow.toggle`:
- Chain `.select("yves_enabled").maybeSingle()` onto the update so the call returns the new row (and surfaces RLS-silent failures as `data === null`).
- If `error` or `!data`, show an inline error and do NOT call `onChange` (revert UI).
- On success, call `onChange({ ...practice, yves_enabled: data.yves_enabled })` with the value the DB actually persisted.

### B. Read the practice flag through a server fn on the client app

Add `src/lib/yves-access.functions.ts` exporting `getClientYvesAccess` — a `createServerFn` (no auth middleware, just takes `clientId`) that dynamically imports `supabaseAdmin` and returns `{ practiceYvesEnabled: boolean, clientYvesEnabled: boolean }` by reading `clients` then `practices`, mirroring the gate logic already in `src/routes/api/public/triage-query.ts` (lines 99–145).

In `src/routes/client.app.yves.tsx` (lines 91–120):
- Replace the direct `supabase.from("practices").select("yves_enabled")` browser query with a call to `getClientYvesAccess({ data: { clientId: id } })`.
- Use the returned `practiceYvesEnabled` to drive `setPracticeYvesEnabled` so the existing `canUseYves` / `accessBlockReason` logic (lines 212–223) reflects the practice-level disable.
- Keep the `profiles.full_name` lookup as-is.

No DB / RLS changes; no schema migrations. Server-side triage gate already enforces the same rule, so this just brings the UI into agreement.

## Verification

- Toggle Yves off in admin → DB row updates to `false` (confirmed via read query) and the pill stays "Off" on reload.
- Sign in as Justin Muller's client → Yves screen shows the practice-disabled message and the submit button is disabled; the per-client toggle on the practitioner page still independently disables when practice is on.