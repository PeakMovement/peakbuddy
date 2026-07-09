// Buddy service worker — offline app shell + web push.
// OneSignal's worker is imported so a SINGLE worker handles both the offline
// shell (below) and web push (OneSignal owns the push + notificationclick
// events, so we do NOT define our own here — that would double-fire).
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDKWorker.js");

// Buddy offline app shell.
// Registered only in browser/PWA contexts (never inside the Despia native
// shell, which keeps its own OneSignal player-ID push). Data offline is
// handled separately by the app's own offline check-in queue; this SW owns
// the shell and push notifications only.

const VERSION = "buddy-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Navigation: network-first with cached shell fallback when offline.
// Static assets (same-origin GET): stale-while-revalidate.
// Never cache API/auth/data requests.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/lovable/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
