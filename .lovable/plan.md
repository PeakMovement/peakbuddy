## What's already in place

- **Global kill switch** lives on `platform_settings.programs_feature_enabled` (super admin only via Admin → Settings).
- **Per-practitioner toggle** lives on `practices.ai_features_enabled` (master) + `practices.programs_suggest_enabled` (legacy narrow gate). Both are editable **only** from `admin.app.practitioner.$practitionerId.tsx`, which is a super-admin-only route. No practitioner or client surface mutates these flags.
- `suggestProgram` (the engine that picks a program after check-in) already calls `isProgramsSuggestEnabledForPractitioner(practitioner_id)` before writing a suggestion, so disabled practitioners stop getting *new* suggestions.

## The gap

The per-practitioner gate is **not** re-checked on the client-facing read/respond paths or on the practitioner queue paths. So if a super admin turns Programs OFF for a practitioner after suggestions already exist:
- Their clients still see the suggestion card in the app and can accept it.
- The practitioner still sees a Program Queue and can approve.

Only the global kill switch currently short-circuits those.

## Fix (single file: `src/lib/client-program.functions.ts`)

Add `isProgramsSuggestEnabledForPractitioner(practitioner_id)` gating to each of these handlers. When disabled, return the same empty/disabled shape they already return when the global flag is off:

1. `getClientBootstrap` — load `client.practitioner_id`; if practitioner is disabled, return `buildState(client, null, wasFirstLogin)` (no program shown).
2. `getMyProgram` — same gate, return `buildState(client, null, false)`.
3. `respondToSuggestedProgram` — refuse with `{ ok: false, error: "Suggested Programs is currently unavailable." }` if practitioner is disabled.
4. `getClientProgramForPractitioner` — return `null` when disabled.
5. `listPendingProgramSuggestions` — return `[]` when the calling practitioner is disabled.
6. `countPendingProgramSuggestions` — return `0` when disabled.
7. `approveProgramSuggestion` — refuse with the same disabled error.

`listActivePrograms` is shared (super-admin-curated catalogue) and stays gated only by the global flag — it's used by Admin and as a dropdown source; gating it per practitioner here would over-block.

No DB migration, no UI changes, no new tools — the toggles, routes, and admin UI already exist and already restrict to super admin.

## Verification after the edit

- Sign in as a client whose practitioner has Programs disabled → no suggestion card, profile shows no program.
- Sign in as that practitioner → Program Queue empty, badge count 0.
- Re-enable in admin → existing suggestion reappears for both sides (the data wasn't deleted, only hidden).
