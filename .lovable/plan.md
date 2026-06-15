## Goal
Add a platform-wide switch in the Super Admin portal that enables or disables the entire "Suggested Programs" feature. When OFF, practitioners cannot send program suggestions to clients, and clients see no program suggestion UI. When ON, behavior is unchanged.

## Where the feature surfaces today
- Practitioner: `practitioner.app.program-queue.tsx` (approval queue), program picker in `practitioner.app.add-client.tsx` and `practitioner.app.client-detail.$clientId.tsx`, nav entry in `practitioner.app.tsx`.
- Client: `ProgramSuggestionCard`, `ProgramIntroModal`, rendered from `client.app.index.tsx` / `client.app.profile.tsx` / `client.app.checkin.tsx`.
- Server: `client-program.functions.ts`, `programs.functions.ts`, AI auto-suggest path in `api/public/triage-query.ts`.

## Plan

### 1. Database
Add `programs_feature_enabled boolean not null default true` to `platform_settings`. Single-row table, no RLS changes needed (admin-only writes already in place).

### 2. Settings read helper
New server fn `getProgramsFeatureEnabled` (public, cached briefly) returning the boolean. Used by both practitioner and client surfaces. Default `true` if no row exists, so existing behavior is preserved.

### 3. Super Admin UI
In `admin.app.settings.tsx`, add a new section "Suggested Programs" with a single toggle bound to `programs_feature_enabled`, persisted alongside existing webhook settings. Short helper text: "When off, practitioners cannot assign programs and clients see no program suggestions."

### 4. Practitioner enforcement
- `practitioner.app.tsx` nav: hide the "Program Queue" link when disabled.
- `practitioner.app.program-queue.tsx`: render a "This feature is currently disabled by the administrator" empty-state instead of the queue.
- `add-client` and `client-detail`: hide the program picker and suggestion controls when disabled.
- Server fns that create/approve suggestions (`approveProgramSuggestion`, any assignment writes, AI auto-suggest in `triage-query.ts`) check the flag and return `{ ok: false, error: "Programs feature disabled" }` (defense in depth so a stale UI cannot bypass).

### 5. Client enforcement
- `client.app.index.tsx`, `client.app.profile.tsx`, `client.app.checkin.tsx`: skip rendering `ProgramSuggestionCard` / `ProgramIntroModal` when disabled.
- `getClientProgramState` server fn returns `status: "none"` and `program: null` when disabled, so even if a card slipped through it would show nothing.

### 6. Data preservation
Existing `suggested_program_id` / `program_status` rows are left untouched. Turning the feature back on restores prior state with no data loss. Turning off does not clear anything — it only hides and blocks new writes.

## Technical notes
- One migration: `ALTER TABLE public.platform_settings ADD COLUMN programs_feature_enabled boolean NOT NULL DEFAULT true;`
- Extend `PlatformSettings` type in `src/lib/types.ts`.
- A single `getProgramsFeatureEnabled` serverFn shared by client + practitioner avoids duplicated logic; read once at layout level (`practitioner.app.tsx`, `client.app.tsx`) via TanStack Query and pass down through context or re-read in children.
- Default `true` ensures zero behavioral change until the admin flips it.

## Out of scope
- Per-practitioner overrides (could be a follow-up).
- Migrating/archiving existing suggestions when disabled.

Confirm and I'll implement.