## Goal

Gate access to Yves (AI triage at `/client/app/yves`) through a three-level permission chain:

1. **Client without a practitioner → blocked.** (Already structurally true — every `clients` row requires `practitioner_id` — but enforce explicitly in the route.)
2. **Practitioner per-client toggle.** Each practitioner can grant/revoke Yves for any of their own clients.
3. **Super admin per-practitioner toggle.** Super admin can disable Yves wholesale for a practitioner; that disables it for every client under them regardless of the per-client setting.

Final rule for a client: `yves_enabled = practitioner.yves_enabled AND client.yves_enabled AND practitioner_id IS NOT NULL`.

## Schema changes (migration)

- `practices`: add `yves_enabled boolean NOT NULL DEFAULT true`.
- `clients`: add `yves_enabled boolean NOT NULL DEFAULT true`.
- RLS: keep existing policies; add update grant so a practitioner can update their own clients' `yves_enabled`, and super admin can update any `practices.yves_enabled` (existing super-admin policy likely already covers it — verify).

No data backfill needed (defaults are `true`, so behavior is unchanged on day one).

## Client app: `/client/app/yves`

At the top of `YvesScreen`'s initial load (right after fetching the client + practitioner name), also fetch `practices.yves_enabled` for the linked practitioner. Compute `canUseYves = !!client.practitioner_id && practitionerYvesEnabled && client.yves_enabled`.

If `canUseYves` is false, render a blocked-state card in place of the input form:

- No practitioner assigned → "Yves is unavailable. You aren't linked to a practitioner yet."
- Practitioner disabled at practice level → "Yves is currently unavailable through your practitioner. Please contact them."
- Per-client disabled → "Your practitioner hasn't enabled Yves for your account. Reach out to them if you'd like access."

Same visual language as the existing "no practitioner / urgent care" cards — navy card, cold-blue heading, single CTA back to `/client/app`. History view (past queries) can stay visible read-only; only the input + submit are gated.

## Practitioner app

**Client detail page** (`practitioner.app.client-detail.$clientId.tsx`): add a "Yves AI triage" row in the client settings area with a toggle bound to `clients.yves_enabled`. Saving writes through `supabase.from("clients").update({ yves_enabled }).eq("id", clientId)`. Show a small note: "When off, this client sees a message asking you to enable it." If the practice-level toggle is off, show the row disabled with helper text "Disabled at practice level by admin."

**Clients list** (`practitioner.app.dashboard.tsx` or wherever the client list lives): add a small "Yves" pill (on/off) per row so the practitioner can see status at a glance. Optional — can fold into client detail only if cleaner.

## Super admin app

**Practitioner detail page** (`admin.app.practitioner.$practitionerId.tsx`): add a "Yves access" toggle in the practice settings card. Writes `practices.yves_enabled` via `supabase.from("practices").update({ yves_enabled }).eq("practitioner_id", practitionerId)`. Caption: "When off, no client under this practitioner can use Yves, regardless of the practitioner's per-client settings."

**Practitioners list** (`admin.app.practitioners.tsx`): add a "Yves" column (green "On" / muted "Off" badge) alongside the existing Active/Pending status.

## Where the rule lives

The gate is enforced client-side in the Yves route (good UX — instant block) AND server-side in the existing `analyzeSymptom` / `analyzeRealTime` call path (security backstop). Add a quick check at the top of those server functions:

- Load the calling client's `practitioner_id` + `clients.yves_enabled`.
- Load that practitioner's `practices.yves_enabled`.
- If any is false / missing, return `{ error: "Yves access disabled" }` without calling the model. This prevents anyone from bypassing the UI by hitting the function directly.

## File touch list

1. New migration in `supabase/migrations/` — add two columns + policies.
2. `src/lib/types.ts` — add `yves_enabled` to `Client` and `Practice`.
3. `src/routes/client.app.yves.tsx` — load practice flag, gate the input UI.
4. `src/lib/yves.ts` (or the server-fn module that wraps it) — add the access check.
5. `src/routes/practitioner.app.client-detail.$clientId.tsx` — per-client toggle UI.
6. `src/routes/admin.app.practitioner.$practitionerId.tsx` — per-practice toggle UI.
7. `src/routes/admin.app.practitioners.tsx` — Yves status column.

## Out of scope

- No new role tier; "super practitioner" maps to the existing `super_admin` role per `src/lib/types.ts`.
- No audit log of who toggled what (can be added later if you want).
- No bulk toggle UI — single-row toggles only.
