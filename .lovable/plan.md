# Remove the AI-consent blocker (pre-rollout)

## Goal

Stop the "This client hasn't consented to AI processing…" message from blocking anything. Everyone currently on the app has already consented, so during this pre-rollout phase Yves should just work for all clients. The consent record stays in the database and the profile toggle stays visible — only the *blocking* behaviour is removed.

## What changes

A single switch controls it, so it can be turned back on for public rollout with a one-line change.

- Add one shared setting, `AI_CONSENT_REQUIRED = false`, in a small helper module with a `hasAiConsent(client)` check that returns true for everyone while the flag is off.
- Route every existing consent gate through that helper instead of checking the field directly:
  - Yves Insight in the Admin/Practitioner Data Hub (the red message in the screenshot)
  - Body Forecast
  - Yves triage query
  - Program suggestions
  - Nightly risk analysis
  - The client Yves screen's "consent required" state
- Wearable connection: drop the mandatory consent modal that currently blocks the OAuth redirect, so connecting a Garmin/Polar/Oura goes straight through.

## What stays

- The `yves_ai_consent` / `yves_ai_consent_at` columns and all existing recorded consents — untouched.
- The "Yves / AI consent" card on the client profile, so patients can still enable or withdraw consent, and the admin Data Hub still displays each client's consent status.
- Withdrawal still recorded; when the flag is flipped back on for rollout, every gate re-enforces immediately with no other code changes.

## Technical notes

- New file `src/lib/ai-consent.ts` exporting `AI_CONSENT_REQUIRED` and `hasAiConsent(client: { yves_ai_consent?: boolean | null })`.
- Replace the direct `!== true` comparisons in `data-hub-insight.functions.ts`, `body-forecast.functions.ts`, `programs.functions.ts`, `api/public/triage-query.ts`, `api/public/hooks/nightly-risk-analysis.ts`, and `routes/client.app.yves.tsx`.
- In `components/wearables/WearablesPanel.tsx`, gate the consent modal behind `AI_CONSENT_REQUIRED` rather than deleting it, so the flow is intact for rollout.
- No migration, no data changes.
