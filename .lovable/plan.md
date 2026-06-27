## Why the badge is there

The "Runtime by Despia" pill in your screenshot is a **watermark Despia overlays on every screen** of apps built on the free / trial tier. It's drawn by the Despia native shell *on top of* your web view — your code can't hide or move it. It sits in the bottom-left corner and, in your current layout, lands right on top of the first tab's icon + label (Check-in).

There are two real fixes. They aren't mutually exclusive.

## Option A — Remove the badge at the source (best fix)

Upgrade the Despia plan / toggle "remove branding" in the Despia dashboard for this app, then rebuild and resubmit the iOS build. Once the watermark is gone, the tab bar is fine as-is. This is the only way to get a clean, professional look — every other workaround is just dodging the badge.

## Option B — Reflow the UI so the badge doesn't cover anything

If you want to keep the free tier (or until the upgrade is live), reshape the bottom tab bar so the Check-in tab isn't underneath the watermark:

1. **Lift the tab bar** — add extra bottom padding (~44px on top of the existing safe-area inset) inside `src/routes/client.app.tsx` so the entire nav sits above the badge instead of behind it.
2. **Add matching bottom padding to `<main>`** so the last row of content (the Energy / Mood rings on the progress page) isn't hidden under the now-taller tab bar.
3. **Re-center the four tabs** — once the bar is lifted, the badge sits in the empty space below the nav, not on top of a label.
4. **Apply the same treatment to the practitioner tab bar** if it exists, so admin/practitioner views on iOS don't have the same clipping.

No other screens or business logic change.

### Technical notes

- File: `src/routes/client.app.tsx`, the `<nav>` at lines ~162–213 and the `<main>` at line 158.
- Change `paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)"` → `"calc(env(safe-area-inset-bottom) + 60px)"` on the nav.
- Change `paddingBottom: 80` → `120` on `<main>`.
- The Despia watermark height is ~48px; 44–60px of extra padding clears it on all current iPhones.

## Recommendation

Do **Option A** if you can — the watermark also appears on other screens (Yves chat, Profile) and only removing it actually solves the problem. Use **Option B** as a same-day mitigation so Check-in is usable in the meantime.

Want me to apply Option B now?