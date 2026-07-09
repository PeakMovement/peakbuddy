// Single source of truth for HOW Buddy is currently running, so push, install
// UX, and autofill can each branch correctly.
//   - "native"        → inside the Despia native shell (keeps OneSignal player-ID push)
//   - "standalone"    → installed PWA launched from the home screen
//   - "browser"       → a normal browser tab (installable, but not installed)
//   - "server"        → SSR / no window yet

export type RuntimeContext = "native" | "standalone" | "browser" | "server";

export function isDespia(): boolean {
  if (typeof navigator === "undefined") return false;
  return /despia/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  // iOS Safari exposes navigator.standalone for home-screen web apps.
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mm || iosStandalone);
}

export function getRuntimeContext(): RuntimeContext {
  if (typeof window === "undefined") return "server";
  if (isDespia()) return "native";
  if (isStandalone()) return "standalone";
  return "browser";
}

/** iOS Safari (not Chrome/Firefox on iOS, which cannot install PWAs). */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as Mac; detect touch to disambiguate.
    (/macintosh/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios|chrome/i.test(ua);
  return isIos && isSafari;
}

/** Register the OneSignal service worker — browser/PWA only, never in Despia. */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (isDespia()) return; // native shell keeps its own push
  if (!("serviceWorker" in navigator)) return;
  const doRegister = () => {
    navigator.serviceWorker
      .register("/OneSignalSDKWorker.js", { scope: "/" })
      .catch(() => {
        /* best-effort; OneSignal also registers this same worker on init */
      });
  };
  // The page "load" event may have ALREADY fired by the time this runs (SPA
  // hydration), so register immediately when the document is ready.
  if (document.readyState === "complete") doRegister();
  else window.addEventListener("load", doRegister, { once: true });
}
