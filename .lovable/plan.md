## Flow at a glance

```text
Practitioner adds client ──► picks suggested program (optional dropdown)
        │
        ▼
Client record saved with: suggested_program_id, status=pending
        │
        ▼
Client signs in for the first time (first_login_at is null)
        │
        ▼
Welcome modal pops up showing the suggested program
        │
   ┌────┴────┐
 Accept    Decline
   │          │
   ▼          ▼
status=    status=
accepted   declined
   │          │
   ▼          ▼
Shown in Client → Profile → "My Program"
(accepted = active card + link to program URL;
 declined = greyed card with "Declined" badge)
        │
        ▼
Mirrored on Practitioner → Client detail page
(status badge: Pending / Accepted / Declined + date)
```

A rendered Mermaid version of the same diagram will be saved to `/mnt/documents/Program_Assignment_Flow.mmd` when we switch to build mode.

## What gets built

### 1. Database (one migration)
Add to `public.clients`:
- `suggested_program_id uuid` → `public.programs(id)` on delete set null
- `program_status text` check in (`pending`, `accepted`, `declined`, `none`) default `none`
- `program_decided_at timestamptz`
- `first_login_at timestamptz` (used to detect first sign-in)

No new tables — keeps it simple and one program per client for now.

### 2. Practitioner: Add Client
File: `src/routes/practitioner.app.add-client.tsx`
- New "Suggested program (optional)" dropdown listing active programs (name only, fetched via a new `listActivePrograms` server fn).
- On submit, save `suggested_program_id`; set `program_status = 'pending'` if a program was picked, else `'none'`.

### 3. Client: first-login detection + welcome modal
- New server fn `getClientBootstrap` returns `{ first_login: boolean, suggested_program | null, program_status }`. If `first_login_at` is null it stamps it `now()` and returns `first_login: true` once.
- New component `WelcomeProgramModal` shown from `src/routes/client.app.tsx` (the client layout) when `first_login && suggested_program && program_status === 'pending'`.
- Buttons:
  - **Yes, join** → calls `respondToSuggestedProgram({ accept: true })` → sets `program_status='accepted'`, stamps `program_decided_at`, opens `external_url` in a new tab.
  - **Not now** → calls `respondToSuggestedProgram({ accept: false })` → sets `program_status='declined'`.

### 4. Client: Profile → "My Program" section
File: `src/routes/client.app.profile.tsx`
- New card:
  - `accepted` → program image + name + description + "Open program" button.
  - `declined` → muted card, "Declined" badge, "Change my mind" button (re-runs respond with accept=true).
  - `pending` → "Review suggested program" button that reopens the modal.
  - `none` → section hidden.

### 5. Practitioner: Client detail mirror
File: `src/routes/practitioner.app.client-detail.$clientId.tsx`
- New "Suggested program" row showing program name + status badge (Pending / Accepted / Declined) + decision date.

### 6. Server functions (new file `src/lib/client-program.functions.ts`)
- `listActivePrograms()` — id+name only, for the practitioner dropdown.
- `getClientBootstrap()` — auth-scoped via `requireSupabaseAuth`, uses `current_client_id()`; performs the first-login stamp and returns the suggested program payload.
- `respondToSuggestedProgram({ accept })` — auth-scoped, updates status + timestamp.
- `getClientProgramForPractitioner({ clientId })` — auth-scoped, returns program + status for the practitioner's client detail view.

### 7. Keeps existing check-in suggestion intact
The post-check-in `ProgramSuggestionCard` flow stays as-is — it's a separate "suggestion based on today's symptoms" surface. The new flow is the practitioner-assigned welcome program.

## Open question (will assume default unless you say otherwise)
If the practitioner doesn't pick a program at onboarding, the welcome modal simply doesn't appear on first login. Confirm or tell me you'd prefer a fallback (e.g. auto-suggest from the symptom matcher on first login).