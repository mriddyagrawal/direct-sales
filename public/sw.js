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

// ---------------------------------------------------------------------------
// Web push (docs/specs/notifications.md). The payload is built server-side by
// the `notify` Edge Function: { title, body, url, tag, ttlClass, badgeCount }.
// body carries the collapsed line + "\n"-joined second-page lines (Android
// pull-down / iOS long-press render the same text). tag + renotify: Android
// keeps ONE evolving card per order and still rings on every replacement (R3);
// iOS ignores tags and stacks — accepted.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let p;
  try {
    p = event.data.json();
  } catch {
    return;
  }
  const tasks = [
    self.registration.showNotification(p.title || "Ganpati Enterprises", {
      body: p.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: p.tag || undefined,
      renotify: !!p.tag,
      data: { url: p.url || "/" },
    }),
  ];
  if (typeof p.badgeCount === "number" && "setAppBadge" in self.navigator) {
    tasks.push(
      p.badgeCount > 0 ? self.navigator.setAppBadge(p.badgeCount) : self.navigator.clearAppBadge(),
    );
  }
  event.waitUntil(Promise.all(tasks));
});

// Tap-to-open (R7 — no buttons in v1): focus the running app and steer it to
// the card's deep link, or open a fresh window at it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
