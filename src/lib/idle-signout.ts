// App-level inactivity auto sign-out.
//
// Sessions in src/integrations/supabase/client.ts persist indefinitely; this
// module signs the user out on their next visit if they haven't touched the
// app for `maxIdleMs`. Real user interactions and tab focus reset the timer;
// background refreshes, push arrivals, and service worker pings do NOT.

import { supabase } from "@/integrations/supabase/client";
import { log } from "@/lib/log";

const STORAGE_KEY = "buddy_last_active_at";
const WRITE_THROTTLE_MS = 60 * 1000; // update localStorage at most once per minute
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // re-check idle status every 5 minutes

let lastWrite = 0;
let initialized = false;

function now(): number {
  return Date.now();
}

function readLastActive(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastActive(ts: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    /* storage full / disabled — swallow */
  }
}

export function markActive(): void {
  if (typeof window === "undefined") return;
  const t = now();
  if (t - lastWrite < WRITE_THROTTLE_MS) return;
  lastWrite = t;
  writeLastActive(t);
}

export function clearIdleTimestamp(): void {
  if (typeof window === "undefined") return;
  lastWrite = 0;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function signOutIfIdle(maxIdleMs: number): Promise<void> {
  const last = readLastActive();
  if (last === null) return; // no baseline yet — treat this session as fresh
  if (now() - last < maxIdleMs) return;

  // Only sign out if there is actually a session to end.
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    clearIdleTimestamp();
    return;
  }

  try {
    await supabase.auth.signOut();
    clearIdleTimestamp();
    log.info("[idle-signout] signed out after inactivity");
  } catch (e) {
    log.error("[idle-signout] signOut failed", e);
  }
}

export function initIdleSignout(opts: { maxIdleMs: number }): () => void {
  if (typeof window === "undefined") return () => undefined;
  if (initialized) return () => undefined;
  initialized = true;

  const { maxIdleMs } = opts;

  // Kick off an initial check, then set a baseline for this visit.
  void signOutIfIdle(maxIdleMs).finally(() => markActive());

  const onActivity = () => markActive();
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      void signOutIfIdle(maxIdleMs).finally(() => markActive());
    }
  };
  const onFocus = () => {
    void signOutIfIdle(maxIdleMs).finally(() => markActive());
  };

  window.addEventListener("pointerdown", onActivity, { passive: true });
  window.addEventListener("keydown", onActivity, { passive: true });
  window.addEventListener("touchstart", onActivity, { passive: true });
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);

  const interval = window.setInterval(() => {
    void signOutIfIdle(maxIdleMs);
  }, CHECK_INTERVAL_MS);

  const { data: sub } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") clearIdleTimestamp();
    else if (event === "SIGNED_IN") markActive();
  });

  return () => {
    window.removeEventListener("pointerdown", onActivity);
    window.removeEventListener("keydown", onActivity);
    window.removeEventListener("touchstart", onActivity);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
    window.clearInterval(interval);
    sub.subscription.unsubscribe();
    initialized = false;
  };
}
