## 24-hour inactivity auto sign-out

Sessions already persist indefinitely (`persistSession + autoRefreshToken` in `src/integrations/supabase/client.ts`). Add an app-level inactivity guard so users who don't open Buddy for 24h are signed out on their next visit.

### How it works

- Track a `buddy_last_active_at` timestamp in `localStorage`, updated on any real user activity.
- On app load, tab focus, and every 5 minutes while the tab is open: if `now − last_active > 24h`, call `supabase.auth.signOut()` and let the existing `_authenticated` gate redirect to the login page.
- On explicit sign-out, clear the timestamp so the next login starts fresh.

### Activity signals

Updated (throttled to ~once/minute) on:
- `pointerdown`, `keydown`, `touchstart` (real user interaction — ignores background tab timers)
- `visibilitychange` when the tab becomes visible
- `focus` on the window

Non-activity signals (background refresh, service worker pings, push notifications arriving) intentionally do NOT reset the timer.

### Files

- **New** `src/lib/idle-signout.ts` — pure helper: `initIdleSignout({ maxIdleMs })`, `markActive()`, `clearIdleTimestamp()`. Client-only (no-op if `typeof window === "undefined"`).
- **Edit** `src/routes/__root.tsx` — call `initIdleSignout({ maxIdleMs: 24 * 60 * 60 * 1000 })` from a `useEffect` alongside the existing `onAuthStateChange` subscriber. Also call `clearIdleTimestamp()` when the event is `SIGNED_OUT`, and `markActive()` on `SIGNED_IN`.

### Behavior notes

- Applies to both patients and practitioners (single Supabase client).
- Does not interrupt an active session — users can leave the app open all day; the timer only bites after 24h of no interaction AND no visible tab.
- If a user's session has expired server-side for any other reason (refresh token revoked, password changed), Supabase's normal 401 → `SIGNED_OUT` flow still handles it.
- No change to the `_authenticated/route.tsx` gate, no new DB columns, no server work.

### Out of scope

- Absolute timeout (force re-login every N days regardless of activity).
- iOS home-screen 7-day localStorage eviction hardening — separate change if wanted later.
- Configuring Supabase's server-side session inactivity setting (would apply globally including background refreshes; app-level is a better fit for "24h since I last touched the app").
