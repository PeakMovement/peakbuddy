## Goal

Satisfy Garmin's two review requirements before submitting screenshots:

1. **Garmin branding** wherever Garmin data appears in the app (per GCDP Brand Guidelines).
2. **Privacy Policy section** describing how Garmin data is collected, used, processed, stored, and shared — reachable via a **direct anchor link**.

## 1. Host the Garmin logo as a Lovable asset

Upload `user-uploads://Garmin_logo_2006.svg.webp` via `lovable-assets` to `src/assets/garmin-logo.webp.asset.json`. This gives every surface a CDN URL, no binary in the repo.

Guideline compliance: the supplied logo is the black wordmark + blue triangle. On our dark navy background it must sit on a **white/light chip** (per Garmin brand rules — no color inversion, min clear space). I'll render it inside a white rounded pill wherever it appears.

## 2. Add branding to every Garmin data surface

Surfaces that currently show Garmin data:

- **`src/components/wearables/WearablesPanel.tsx`** — replace the generic hand-drawn `<ProviderMark provider="garmin">` SVG with the official Garmin logo chip. The card already says "Garmin"; the logo replaces the placeholder mark.
- **`src/components/wearables/WearableTiles.tsx`** — when the connected provider is `garmin`, render a small "Powered by [Garmin logo]" attribution row above the metric grid (in addition to the existing "Garmin · your metrics" label).
- **`src/routes/client.app.profile.tsx`** — verify the wearables tile that lists connected providers shows the Garmin mark (uses `WearablesPanel`, so covered by the change above).

A small reusable `<GarminAttribution />` component in `src/components/wearables/GarminAttribution.tsx` will render the white-chip logo at two sizes (`sm` for tiles, `md` for the Wearables panel card) so all surfaces stay consistent.

## 3. Add the Garmin section to the Privacy Policy

Edit `src/routes/privacy-policy.tsx` — insert a new `<section id="garmin">` after the existing AI section (currently `#ai`). Content:

- **What we collect via Garmin Health API:** daily summaries, sleep, HRV, activities, epochs, stress, user metrics — as pushed by Garmin's webhooks (no on-demand pulls).
- **How it's collected:** OAuth 2.0 + PKCE consent in Garmin Connect; user can revoke in Garmin Connect at any time.
- **How it's used:** displayed to the user, shared with their linked practitioner for clinical review, and used as context signals for the Yves triage assistant (HRV/RHR/sleep deltas).
- **Third-party processing of Garmin data:**
  - Anthropic (Yves triage) — only when the user has consented to AI features.
  - Google via Lovable AI Gateway (program suggestions) — only when the user has consented.
  - Cloud hosting/database provider — encrypted at rest.
  - Garmin data is **never sold** and **never used to train AI models**.
- **Storage & retention:** encrypted at rest; retained while the connection is active + statutory healthcare retention; deleted on disconnect or on request.
- **User control:** disconnect in Profile → Wearables removes the token and stops all data flow; deregistration webhooks from Garmin are honored automatically.

Deep-link URL to give Garmin: **`https://peakbuddy.lovable.app/privacy-policy#garmin`**

Also add a small "Garmin Health Data" entry to the on-page ToC / anchor list if one exists (currently no ToC — sections are numbered; I'll insert as **§5. Garmin Health Data** and renumber subsequent sections, or append as §14 to avoid renumber churn — recommending **append as §14** to minimize diff).

## Out of scope

- Any change to Garmin OAuth/webhook logic (already built).
- Enabling the Health API in Garmin's config portal — that's a step you do in `apis.garmin.com/tools/apiConfiguration`, not something the app can do.
- Rewording the rest of the privacy policy.

## Files touched

- `src/assets/garmin-logo.webp.asset.json` (new — CDN pointer)
- `src/components/wearables/GarminAttribution.tsx` (new)
- `src/components/wearables/WearablesPanel.tsx` (swap Garmin ProviderMark)
- `src/components/wearables/WearableTiles.tsx` (add attribution row for Garmin)
- `src/routes/privacy-policy.tsx` (add `#garmin` section)
