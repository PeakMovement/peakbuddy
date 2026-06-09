## What we're building

After a patient submits a check-in, show a "Recommended program" card on the success screen. The card has the program name, short description, why it was suggested, and a **Join program** button that opens the program's external URL in a new tab.

## Data model

New table `public.programs` in Lovable Cloud:

- `name` (text)
- `description` (text)
- `external_url` (text — where Join takes the patient)
- `symptom_tags` (text[] — e.g. `['lower-back', 'sleep', 'stress', 'high-pain']`)
- `pain_min`, `pain_max` (int, nullable — optional pain range filter)
- `active` (bool, default true)
- `priority` (int, default 0 — higher wins on ties)
- standard `id`, `created_at`, `updated_at`

Access:
- `GRANT SELECT` to `anon` + `authenticated` (programs are non-sensitive catalog data the client app needs to read).
- `GRANT ALL` to `service_role`.
- RLS enabled; one policy: anyone can read `active = true` rows. Writes via service role only (admin UI later).

I'll seed 3–5 example rows so the flow is testable immediately. You can edit them later from the backend table view, or I can add a super-admin CRUD screen if you want.

## Matching logic (rules first, AI fallback)

A server function `suggestProgram` takes the check-in payload (pain, sleep, stress, energy, mood, notes) and:

1. **Rules pass** — derive tags from the check-in (e.g. pain ≥ 7 → `high-pain`; sleep ≤ 2 → `sleep`; stress ≥ 4 → `stress`; keyword scan of notes for `back`, `neck`, `knee`, `headache`, etc.). Pick the active program with the most tag overlap (and matching pain range if set), tie-broken by `priority`.
2. **AI fallback** — if no rule matches, call Lovable AI (`google/gemini-3-flash-preview`) with the check-in summary + the list of active programs (id, name, description, tags) and ask for the best-fit `program_id` plus a one-sentence reason. Validate the returned id exists.
3. Return `{ program, reason, source: 'rules' | 'ai' }` or `null` if nothing fits.

This runs server-side via `createServerFn` so the AI key stays on the server and we get RLS-safe reads via `supabaseAdmin`.

## UI changes

In `src/routes/client.app.checkin.tsx`, after a successful submit:

- Call `suggestProgram` with the saved check-in.
- On the existing success view, render a new `ProgramSuggestionCard` below the confirmation:
  - Program name + short description
  - One-line "Why this?" reason
  - **Join program →** primary button (`<a href={external_url} target="_blank" rel="noopener noreferrer">`)
  - Subtle "Not now" dismiss
- If `suggestProgram` returns null or errors, the success screen renders as it does today (no card, no error noise).

No changes to existing check-in submit / alert / Yves flows.

## Files

- `supabase/migration` — new `programs` table + RLS + grants + seed rows.
- `src/lib/programs.functions.ts` — `suggestProgram` server fn (rules + AI fallback).
- `src/lib/ai-gateway.server.ts` — Lovable AI Gateway provider helper (if not already present).
- `src/components/ProgramSuggestionCard.tsx` — presentational card with Join button.
- `src/routes/client.app.checkin.tsx` — call `suggestProgram` after submit, render card on success.

## Verification

- Submit a high-pain check-in → see a matching program card with Join button that opens the external URL in a new tab.
- Submit a check-in with notes mentioning "back" → matched program reflects that tag.
- Temporarily disable all rule matches → AI fallback returns a program with a reason.
- Set all programs `active = false` → success screen renders with no card (graceful).
