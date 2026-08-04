# Add an AI-consent toggle to the client Profile page

## What you asked
The screenshot shows the practitioner Data Hub Yves Insight card with the message:

> "This client hasn't consented to AI processing, so Yves Insight is unavailable for them until they enable AI consent in their Buddy profile."

You asked: **how does a patient do this?**

## Current state
A patient can currently consent in two places, but neither is the Profile page the error message refers to:

1. **Yves chat screen** (`/client/app/yves`) — a consent modal automatically appears the first time they open Yves if they haven't consented yet.
2. **Wearables panel** (`/client/app/profile` → Wearables dropdown → Connect a device) — a consent dialog appears before every wearable OAuth connection.

The Profile page itself has **no AI-consent toggle**, so the error message is misleading. Patients have no obvious, always-available place to enable or withdraw consent.

## Proposed fix
Add a dedicated **"Yves / AI consent"** card to the client Profile page (`/client/app/profile`) that:

- Shows the current consent status clearly ("Enabled" / "Disabled").
- Lets the patient toggle consent on or off with a single tap.
- Calls the existing `setYvesAiConsent` server function used by Yves and Wearables.
- Updates local client state immediately so the toggle reflects the change without a refresh.
- Includes a short explanation of what consenting means, with a link to the privacy policy's AI section.
- Is styled with the existing Buddy brand tokens (no new colors).

## Why this matters
It makes the error message in the Data Hub accurate, gives patients direct control, and reduces support burden on practitioners who currently see the "not consented" block but can't point the patient to a single place to fix it.

## Technical details
- File to edit: `src/routes/client.app.profile.tsx`.
- Import `setYvesAiConsent` from `@/lib/yves-consent.functions` and wire it with `useServerFn`.
- Add state for `consentSaving` and a local optimistic update to `client.yves_ai_consent`.
- Place the new card below the existing profile fields and above the Notification status section.
- No database or RLS changes needed — the existing `clients.yves_ai_consent` column and `setYvesAiConsent` server function already handle authorization (client themselves, their practitioner, or super admin).
- No changes to the practitioner Data Hub error copy are required; after this change it will finally be true.
