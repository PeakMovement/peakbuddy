## Direction

V1 (vivid blue square + cream "B") becomes the official Buddy brand. The current app uses near-black navy (#0a0e1a) which feels too dark, like v3. We'll lift the whole app into a brighter, blue-forward palette and re-shoot the App Store screenshots to match.

## New palette (replaces existing tokens in `src/styles.css`)

| Token | Before | After | Use |
|---|---|---|---|
| `--navy` | `#0a0e1a` (near black) | `#1a2952` (rich mid-navy) | App background |
| `--navy-card` | `#111827` | `#243a6b` | Cards / surfaces |
| `--navy-border` | `#1e2a3a` | `#3658a3` | Borders / dividers |
| `--blue-accent` | `#3b82f6` | `#4a8df0` (v1 icon blue) | Primary buttons, CTAs, brand mark |
| `--blue-cold` | `#6b9ab8` | `#9ec2e8` | Secondary accent, sub-labels |
| `--white` | `#f0ece4` (cream) | `#f0ece4` (unchanged) | Text |
| `--white-muted` | `#9ca3af` | `#b8c5db` | Muted text (tuned for new bg) |

Status colors (`--green` / `--amber` / `--red`) stay; they read fine on the lighter navy.

Result: the app feels closer to v1 — deep but vibrant blue instead of black, cream text, vivid blue accents. No layout or component changes.

## Brand assets

- Replace the in-app `CrosshairLogo` / favicon with the v1 "B" mark on small splash/header surfaces where it makes sense. Keep the crosshair reticle as a secondary brand element (used in Yves assessment cards, loading states).
- Add `app-icon-B-v1.png` into the project at `public/icon.png` so the browser tab and any social cards pick it up.
- Update `<link rel="icon">` in `__root.tsx` to point to it.

## Marketing screenshots (regenerate)

Re-shoot all 5 portrait images with the new lighter blue background, keeping the same headlines, mock UI, and artificial data. Output to `/mnt/documents/appstore/`, overwriting:

- `screenshot-1-checkin.png` — "Your health, monitored daily."
- `screenshot-2-yves.png` — "Meet Yves. Your AI triage."
- `screenshot-3-timeline.png` — "See your progress."
- `screenshot-4-practitioner.png` — "For practitioners."
- `screenshot-5-alerts.png` — "Catch problems early."

Each will use the v1 blue (`#4a8df0`) as the marketing backdrop with cream serif headline, and the phone mockup will show the newly-themed app interior so the screenshots match what users will actually see in-app.

## What I won't touch

- Component structure, copy, routing, auth, server functions — all unchanged.
- Status semantics (green/amber/red) — kept for clinical clarity.
- The original crosshair `CrosshairLogo` component stays in the codebase; just demoted to a secondary mark.

## Order of operations

1. Update color tokens in `src/styles.css`.
2. Add `public/icon.png` (v1 B) + wire favicon in `__root.tsx`.
3. Spot-check 2–3 key screens in preview, tweak token values if contrast looks off.
4. Regenerate the 5 marketing screenshots.
