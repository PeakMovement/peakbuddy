// Trivial same-origin service worker used only by the diagnostic to test
// whether ANY service worker can register in this environment.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => self.clients.claim());
