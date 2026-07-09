// Minimal service worker — its purpose is PWA installability. Chrome only
// promotes a site from "shortcut with a badge" to a real installed WebAPK
// (our receipt icon, no Chrome badge, standalone window) when the manifest is
// paired with a registered service worker that has a non-trivial fetch
// handler. This one is a straight network passthrough: no caching, no offline
// magic, no staleness bugs — the app behaves exactly as before, it just
// becomes installable. (Chrome skips no-op fetch handlers, so the passthrough
// respondWith is deliberate, not decorative.)

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
