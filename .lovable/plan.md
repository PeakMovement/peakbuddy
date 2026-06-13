## Goal

Two new gates on the program-suggestion flow:

1. **Super admin must approve a program** before any practitioner can use it (separate from the existing `active` toggle, which stays as an on/off switch).
2. **Every program suggestion to a client must be approved by that client's practitioner** before the client sees it. The check-in engine no longer pushes suggestions directly to clients.

## Database changes (one migration)

**`programs` table**
- Add `approved_by_admin boolean not null default false`
- Add `approved_by uuid null` (references the super-admin who approved)
- Add `approved_at timestamptz null`
- Backfill `approved_by_admin = true` for the 14 existing programs so the live app keeps working.

**`clients` table**
- Extend the `program_status` check constraint to include `'awaiting_practitioner'`.
- Add `program_suggested_by` text (`'auto_rules' | 'auto_ai' | 'practitioner'`) and `program_suggested_at timestamptz` so the practitioner can see why a suggestion landed in their queue.

**Data reset (per your answer)**
- For every client with `program_status in ('pending','accepted')`, move them to `program_status = 'awaiting_practitioner'`, clear `program_decided_at`, and stamp `program_suggested_by = 'auto_rules'`, `program_suggested_at = now()`. Practitioners then re-approve.

**RLS / functions**
- Keep super-admin-only access for write paths via the existing `assertSuperAdmin` helper.
- No new RLS policy is required for clients reading their program — the existing client RLS already covers it; the check-in engine simply will not write `pending` rows anymore.

## Server function changes

**`admin-programs.functions.ts`**
- `listAllPrograms` already returns everything; expose the new `approved_by_admin` field.
- New `setProgramApproval({ id, approved })` — super admin only. Sets `approved_by_admin`, `approved_by`, `approved_at`. A program must be both `active = true` and `approved_by_admin = true` to be usable.

**`client-program.functions.ts`**
- `listActivePrograms` (used by the practitioner add-client dropdown) → filter to `active = true AND approved_by_admin = true`.
- New `listPendingProgramSuggestions()` — returns clients owned by the calling practitioner where `program_status = 'awaiting_practitioner'`, including the candidate program details and the source (`auto_rules` / `auto_ai` / `practitioner`).
- New `approveProgramSuggestion({ clientId })` — practitioner-only ownership check. Flips status from `awaiting_practitioner` → `pending` (so the client sees the intro card on next sign-in). Records `program_decided_at = now()`.
- New `rejectProgramSuggestion({ clientId })` — clears `suggested_program_id`, sets status `none`.
- `respondToSuggestedProgram` (client-side accept/decline) is unchanged.

**`programs.functions.ts` (the `suggestProgram` engine called from check-in)**
- Stop returning a suggestion card to the client. Instead, when the engine finds a match (rules or AI), write it to the client's row as:
  - `suggested_program_id = <match>`,
  - `program_status = 'awaiting_practitioner'`,
  - `program_suggested_by = 'auto_rules' | 'auto_ai'`,
  - `program_suggested_at = now()`,
  only if the client has no active suggestion yet (`program_status in ('none','declined')`).
- Skip the assigned-program reinforcement branch; that program is already approved and visible.
- Return `null` to the check-in UI in the new flow (no more on-screen suggestion card after submitting).

## UI changes

**Super admin → `/admin/app/programs`**
- Add an "Approved" badge and an "Approve / Unapprove" action per program (next to Edit / Delete).
- Programs that are `active` but not approved render with a yellow "Awaiting approval" pill so the admin sees the queue.

**Practitioner → new `/practitioner/app/program-queue` route + Alerts nav badge**
- List of clients with `program_status = 'awaiting_practitioner'`, showing client name, candidate program, why it was suggested (rules tags / AI / manual), and Approve / Reject buttons.
- Add a small count badge wherever the practitioner sidebar / dashboard surfaces alerts so they notice items waiting.

**Practitioner → `/practitioner/app/add-client`**
- The dropdown still lists only admin-approved + active programs.
- When the practitioner manually assigns a program here, it skips the queue (manual = already approved by the practitioner) and goes straight to `pending` as today, with `program_suggested_by = 'practitioner'`.

**Client → `/client/app/checkin`**
- Remove the post-check-in `ProgramSuggestionCard`. The client only sees a suggestion once the practitioner has approved it, via the existing intro modal driven by `getClientBootstrap`.

## Technical notes

- The migration is data-changing (constraint widen + bulk update of existing client rows). Per the database rules, schema changes go through the migration tool and the bulk row update piggybacks on the same migration since it depends on the new check-constraint value.
- All new server fns use `requireSupabaseAuth` and reuse `assertSuperAdmin` / practitioner ownership checks already in `client-program.functions.ts`.
- `listActivePrograms` is called from the practitioner UI and is the only place the "usable program" filter needs to change for the dropdown.
- No edge functions; everything stays in TanStack server functions.

## Out of scope

- Notifications/emails to the practitioner when a new suggestion lands (queue badge only).
- Editing the AI suggestion engine's matching logic.
- Multi-practitioner approval / handoff.
