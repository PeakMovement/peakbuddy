# Softer Program Onboarding

Replace the current single-screen accept/decline modal with a friendlier, more visual flow that gives clients context and a graceful way to defer.

## What changes for the client

A 3-step **"Meet your program"** intro appears on first login (still modal, but feels like a guided tour, not a pop quiz):

```text
Step 1 — Welcome           Step 2 — About the program     Step 3 — Your choice
┌─────────────────────┐    ┌─────────────────────────┐    ┌──────────────────────┐
│  Hi {firstName} 👋  │    │  Program cover image    │    │  Ready to start?     │
│                     │    │  Program name           │    │                      │
│  Welcome to Buddy.  │    │  Duration · Focus area  │    │  [ Yes, start now ]  │
│  Your practitioner  │    │                         │    │  [ Remind me later ] │
│  has something for  │    │  Visual highlights:     │    │  [ Not for me ]      │
│  you.               │    │   • Outcome 1 (icon)    │    │                      │
│                     │    │   • Outcome 2 (icon)    │    │  "Note from {Prac}:  │
│        [ Next → ]   │    │   • What you'll do      │    │   {personal note}"   │
└─────────────────────┘    │        [ Next → ]       │    └──────────────────────┘
                           └─────────────────────────┘
```

Key differences vs today:
- **Visual program preview** — cover image, outcome highlights with icons, duration/focus tags, short description. Client sees *what* before being asked to commit.
- **Three choices** instead of two: Accept · **Remind me later** · Decline.
- **Personal note** from the practitioner shown on the final step (when provided).
- **Dismissable** — closing the modal counts as "remind me later", not a decline.
- **Re-surfaces** — if status is `pending`, show a soft banner on the client dashboard ("Your practitioner suggested a program — take a look") that re-opens the intro.

## What changes for the practitioner

In the **Add Client** form, the existing program dropdown gets two new optional fields:

- **Personal note** (textarea, 280 chars) — "Add a short message your client will see with the suggestion."
- **Key outcomes** is read from the program itself (no new field per client) — see schema below.

On the **Client detail** page, the status badge gains a third state: **Pending** (alongside Accepted / Declined), with the date of last interaction.

## What changes for program setup

Programs get richer fields so the intro has something visual to show:
- `cover_image_url` — hero image for step 2
- `duration_label` — e.g. "4 weeks", "Daily, 10 min"
- `focus_area` — short tag, e.g. "Sleep", "Stress"
- `outcomes` — array of 3 short strings ("Sleep more deeply", "Reduce evening anxiety", …)

These render as the visual highlights in step 2. If a program is missing them, step 2 falls back to the description only.

## Technical details

**DB migration:**
- `programs`: add `cover_image_url text`, `duration_label text`, `focus_area text`, `outcomes text[]`.
- `clients`: add `program_personal_note text` (practitioner's note to this client).
- `clients.program_status` enum/text: extend allowed values to include `pending` (in addition to existing `accepted` / `declined`). New default on assignment = `pending` (instead of jumping straight to a yes/no prompt).
- Add `clients.program_reminder_snoozed_until timestamptz` so "Remind me later" can suppress the banner for e.g. 3 days.

**Server functions** (`src/lib/client-program.functions.ts`):
- Extend `setClientProgramStatus` to accept `pending` and to set `program_reminder_snoozed_until` when status = `pending`.
- New `getClientProgramSuggestion` returning program + personal note + status for the logged-in client.

**Frontend:**
- Replace `src/components/WelcomeProgramModal.tsx` with a stepped component (`ProgramIntroModal`) — three panels, progress dots, Back/Next, final-step CTAs.
- Add `ProgramSuggestionBanner` on the client dashboard for `pending` status (respects snooze).
- Practitioner Add Client form (`src/routes/practitioner.app.add-client.tsx`) — add the **Personal note** textarea below the program dropdown, only enabled when a program is selected.
- Practitioner Client Detail (`src/routes/practitioner.app.client-detail.$clientId.tsx`) — add `Pending` to the status badge variants.

**No business logic changes** to check-ins, alerts, or other flows.

## Out of scope (call out, don't build)

- Contextual nudges tied to check-in content (option 7).
- Pre-login email warm-up (option 8).
- Progressive delay until login #2 (option 6).

Happy to fold any of these in — just say which.