// 推送通知 (src/worker/push.ts sends them; src/web/Push.tsx turns them on). It only shows
// notifications and opens the site when one is tapped: no fetch handler and no caching, so the
// site loads exactly as it does without it.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "羽毛球", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icon-192.png",
      lang: "zh-CN",
      data: { url: data.url || "/" },
    }),
  );
});

// The member's own page, saved when push was turned on (Push.tsx). A link member's events and
// bills are only on their link page; someone signed in with Google can open the event itself.
async function home() {
  try {
    const cache = await caches.open("push");
    const res = await cache.match("/push-home");
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const own = await home();
      const url = new URL(own?.startsWith("/m/") ? own : event.notification.data?.url || "/", self.location.origin);
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).pathname === url.pathname && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
