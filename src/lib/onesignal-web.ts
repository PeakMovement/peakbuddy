// OneSignal Web SDK (v16) integration for the browser / installed-PWA context.
// Complements the Despia native player-ID flow: native uses the despia bridge,
// the web/PWA build uses this. Both feed the same OneSignal app, so the backend
// keeps sending via include_player_ids with no change.
//
// The SDK is told to use Buddy's OWN service worker (public/sw.js), which
// importScripts OneSignal's worker — so we run a single worker that does both
// the offline shell and push, avoiding a two-worker conflict.

import { getRuntimeContext } from "@/lib/runtime-context";

const APP_ID = "334ee7c1-86d8-4cff-9317-575b798a6ef9";
const SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

type OneSignalApi = {
  init: (opts: Record<string, unknown>) => Promise<void>;
  Notifications: {
    permission: boolean;
    requestPermission: () => Promise<void>;
  };
  User: {
    PushSubscription: {
      id?: string | null;
      optIn: () => Promise<void>;
    };
  };
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(os: OneSignalApi) => void | Promise<void>>;
  }
}

let initStarted = false;
let readyResolve: ((os: OneSignalApi) => void) | null = null;
const ready: Promise<OneSignalApi> = new Promise((res) => {
  readyResolve = res;
});

/** Load + init the OneSignal Web SDK. Browser/PWA only; never in Despia/SSR. */
export function initOneSignalWeb(): void {
  if (initStarted) return;
  const ctx = getRuntimeContext();
  if (ctx === "native" || ctx === "server") return; // native keeps its own push
  initStarted = true;

  // Inject the SDK script once.
  if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.defer = true;
    document.head.appendChild(s);
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (OneSignal) => {
    try {
      await OneSignal.init({
        appId: APP_ID,
        // Use our combined service worker instead of OneSignal's default file.
        serviceWorkerParam: { scope: "/" },
        serviceWorkerPath: "sw.js",
        serviceWorkerOverrideForTypical: true,
        allowLocalhostAsSecureOrigin: true,
      });
      readyResolve?.(OneSignal);
    } catch {
      /* init is best-effort; the app works without web push */
    }
  });
}

/** Await the initialised SDK (resolves once init completes). */
function whenReady(timeoutMs = 8000): Promise<OneSignalApi | null> {
  return Promise.race([
    ready,
    new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
  ]);
}

/** True if this context can use web push (not native, browser supports it). */
export function webPushSupported(): boolean {
  const ctx = getRuntimeContext();
  if (ctx === "native" || ctx === "server") return false;
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Prompt for permission and opt the user in. Returns the OneSignal subscription
 * id (targetable by include_player_ids) once subscribed, else null.
 */
export async function subscribeWebPush(): Promise<string | null> {
  initOneSignalWeb();
  const os = await whenReady();
  if (!os) return null;
  try {
    if (!os.Notifications.permission) {
      await os.Notifications.requestPermission();
    }
    await os.User.PushSubscription.optIn();
  } catch {
    /* user may have denied */
  }
  // Give the subscription a moment to register.
  for (let i = 0; i < 10; i++) {
    const id = os.User.PushSubscription.id;
    if (id) return id;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

/** Current web subscription id, if already subscribed. */
export async function getWebSubscriptionId(): Promise<string | null> {
  const os = await whenReady(3000);
  return os?.User?.PushSubscription?.id ?? null;
}
