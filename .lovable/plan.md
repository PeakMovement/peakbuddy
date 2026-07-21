# Garmin Attribution Rollout

Meet Garmin Health API brand/attribution requirements across every surface that displays Garmin data. No other functionality, styling, or copy changes.

## 1. Assets

- Upload `user-uploads://Garmin-Tag-white-attribution.png` to the CDN via `lovable-assets` as `src/assets/garmin-tag-white.png.asset.json`.
- Keep the existing `garmin-logo.webp` asset for now (used only on the connect panel white chip); the new tag replaces it on the dashboard Garmin card header.

## 2. Capture Garmin device model (best-effort)

Garmin Health API only reliably reports device name on **activity** payloads (`deviceName`), not on dailies/sleep/HRV summaries. To support "Garmin {model}" without inventing data:

- Add `garmin_device_model text` to `wearable_connections` (nullable).
- In `src/routes/api/public/wearables/garmin/webhook.ts`, when an `activities` payload arrives with `deviceName`, upsert the most recent value onto the user's `wearable_connections` row.
- Expose it on `WearableSnapshot` (`snapshot.functions.ts`) as `deviceModel: string | null` alongside `provider`.
- When missing, components render just `Garmin` (spec-compliant fallback).

## 3. Reusable attribution component

Extend `src/components/wearables/GarminAttribution.tsx`:

- New props: `deviceModel?: string | null`, `variant?: "text" | "logo"` (default `"text"`), keep existing `size`.
- `variant="text"` → muted caption `Garmin {model}` (or `Garmin`) using existing `--white-muted` token, `font-ui`, ~12px. No chip, no logo. This is what every screen except the dashboard card header uses.
- `variant="logo"` → the new white Garmin tag image at 16–20px tall (natural aspect ratio, no recolor/rotate/crop/effects) followed by the model text. Used **only** on the Garmin dashboard card header.
- Also export a small `<YvesGarminCaption />` helper that renders the exact required string: `Insights derived in part from Garmin device-sourced data.` (unchanged wording).

## 4. Placement — screens to update

Attribution goes directly under/next to the section title, above the fold, always visible (never in tooltip/accordion/popover). Show once per Garmin section, not per row. Only render when the user is actually connected to Garmin (`provider === "garmin"`).

Screens/components to edit:

1. `src/components/wearables/WearableTiles.tsx` — client Progress page Garmin metrics grid. Replace current `<GarminAttribution size="sm" showPoweredBy />` with the new text variant showing `Garmin {model}` under the "Garmin · your metrics" heading. (Covers HRV, sleep, stress, steps, Body Battery, RHR, activity, distance — all rendered by this grid.)
2. `src/components/wearables/WearablesPanel.tsx` — Garmin dashboard card header. Swap the current inline white chip for `<GarminAttribution variant="logo" deviceModel={...} />` next to the card title.
3. `src/components/ClientWearablesCard.tsx` — practitioner "Wearable" section on client detail. Add the text attribution beside the section title when `rows[0].source === "garmin"`.
4. `src/components/BodyForecastBeta.tsx` — when the forecast is built from Garmin data, add the text attribution + the required Yves caption ("Insights derived in part from Garmin device-sourced data.") beneath the card title, since this feeds Yves.
5. `src/routes/client.app.yves.tsx` — where wearable context is shown/mentioned, render the Yves caption once above the fold when the client's connected provider is Garmin.
6. `src/routes/practitioner.app.client-detail.$clientId.tsx` — if the practitioner view surfaces Garmin-derived signals in the wearable/insights area, add the text attribution once at the section header (single instance, not per row).

If any of those screens already shows non-Garmin (Oura/Polar) data too, attribution renders only for the Garmin subset.

## 5. Empty / disconnected state

Every insertion is guarded by "user is connected to Garmin AND has Garmin data present". No logo, no text, no Yves caption when there's no Garmin data.

## 6. Rules explicitly enforced

- Logo appears **only** on the WearablesPanel Garmin card header. Every other screen uses the plain text variant.
- Logo not recolored/stretched/cropped/rotated/animated; aspect ratio preserved via `width: auto`.
- Yves caption wording is a constant string; no variants.
- No phrases like "Garmin insights" or "Garmin model" anywhere.

## 7. After implementation

Post a checklist of every file/screen touched so you can verify coverage before screenshots.

## Technical notes

- Migration: single `ALTER TABLE public.wearable_connections ADD COLUMN garmin_device_model text` with existing RLS/grants unchanged.
- Webhook change is additive (best-effort upsert from `activities[].deviceName`); no behavior change if the field is absent.
- Snapshot type extension is nullable so all consumers compile without change; only the attribution component reads it.
- No changes to color tokens, layout, spacing, or any non-attribution copy.
