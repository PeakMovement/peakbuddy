# Speed up Buddy — performance plan

The admin portal lives at:
- Preview: `/admin/login` on `id-preview--dc4837ba-a8b4-4d41-94c5-6fc0860cbad8.lovable.app`
- Published: `https://peakbuddy.lovable.app/admin/login`

After auditing the codebase I found five concrete wins. None change features or visuals — purely speed.

## 1. Self‑host fonts (biggest single win)

`src/styles.css` line 1 currently does:
```
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond...&family=Rajdhani...&family=Space+Mono...&display=swap');
```
This is a render‑blocking request to Google before any CSS is parsed, and on every page load. Switch to `@fontsource` packages (Space Mono is already installed) so the fonts ship with the bundle and load in parallel with the app code. Also drop weights we don't use (currently importing 9 weights total, the app only uses 4).

## 2. Remove the global `!important` transition rule

`src/styles.css` line 45:
```css
* { transition-duration: 200ms !important; animation-duration: 400ms; }
```
The `* { … !important }` selector forces the browser to recompute transition styles for **every DOM node** and overrides component‑level transitions. This causes jank on screens with long lists (alerts, clients, timeline). Replace with targeted classes or remove — components that need transitions already declare them.

## 3. Parallelize sequential Supabase queries

Several screens fire queries one after another inside `useEffect`. Examples:
- `practitioner.app.dashboard.tsx`, `practitioner.app.client-detail.$clientId.tsx`, `admin.app.practitioner.$practitionerId.tsx` — each does 3–5 sequential `await supabase…` calls.
- `client.app.checkin.tsx` and `client.app.yves.tsx` — auth check, then profile fetch, then practice settings, serially.

Wrap independent queries in `Promise.all([...])`. On a typical mobile connection this cuts perceived load on those screens roughly in half.

## 4. Use TanStack Router prefetch + React Query caching

Right now every navigation re-runs `useEffect` and re‑queries Supabase. Two small changes:
- Set `defaultPreload: "intent"` and bump `defaultPreloadStaleTime` in `src/router.tsx` so hovering/tapping a tab kicks off the next screen's data.
- Move the per‑screen `useEffect`+`useState` data fetches into `useQuery` with stable keys (we already have `QueryClientProvider` mounted). Re‑visiting a tab is then instant from cache and revalidated in the background.

## 5. Lighten the landing page

`src/routes/index.tsx` is the public homepage but the root layout (`__root.tsx`) and route bundles pull in the full auth/Supabase client on first paint. Two small tweaks:
- Move the Supabase import out of any module that the landing page touches (lazy‑import inside the login routes).
- Add a `<link rel="preload" as="font" …>` for the Cormorant heading font (LCP candidate) once fonts are self‑hosted.

## What I won't touch
- No feature or visual changes
- No backend / RLS / webhook changes (Phase 2 stays as‑is)
- No new dependencies beyond `@fontsource/cormorant-garamond` and `@fontsource/rajdhani`

## Expected impact
- First paint on landing & login: ~300–600 ms faster (no Google Fonts blocking request)
- Practitioner dashboard / client detail: ~40–50 % faster initial render (parallel queries)
- Tab switches inside the app: near‑instant after the first visit (query cache + prefetch)
- General scroll/animation smoothness: noticeably less jank (no global `!important` transitions)

Approve and I'll apply all five in one pass and verify the build.
