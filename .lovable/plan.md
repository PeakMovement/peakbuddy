## Goal
Produce a set of polished iPhone-mockup screenshots of PeakBuddy for advertising, saved to `/mnt/documents/`.

## Capture plan
Viewport: 390x844 (iPhone 12/13/14 size). Login: client code `7874`.

Screens to capture:
1. Landing / home page (`/`) — hero
2. Landing — scrolled to a feature/section below the fold
3. Client login screen (code entry)
4. Client portal home (after entering `7874`)
5. Yves AI triage screen — empty state
6. Yves AI triage screen — with a sample query typed (e.g. "My lower back hurts when I sit") showing the AI result
7. Daily check-in screen
8. Any other notable client-portal screen I find while navigating (alerts, history, profile — whichever exist)

If a screen requires a practitioner login I'll skip it (no practitioner credentials provided) and note it in the final summary.

## Visual treatment
Each raw screenshot will be composited into an iPhone device frame (rounded corners, notch/island, subtle bezel) on a soft mesh-gradient backdrop tuned to PeakBuddy's palette. Output: one PNG per screen at ~1200x1500, plus one "hero" composition with 2-3 phones arranged together for use as a primary ad image.

## Technical approach
- Use the browser tool at 390x844 to navigate each route, log in with code `7874`, type a sample Yves query, and screenshot.
- Use Python (Pillow) to: round screenshot corners, drop into a phone-shaped frame with shadow, render a mesh gradient background, and compose the multi-phone hero shot.
- Save outputs to `/mnt/documents/ads/` and emit `presentation-artifact` tags for each file.
- QA every output by re-opening the PNG before delivering.

## Deliverables
- `/mnt/documents/ads/01-landing.png` … `NN-<screen>.png` (one per screen)
- `/mnt/documents/ads/hero-multi-phone.png` (composite)
- Short summary listing what was captured and anything skipped.
