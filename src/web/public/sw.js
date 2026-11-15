// 推送通知 (src/worker/push.ts sends them; src/web/Push.tsx turns them on): shows notifications and
// opens the site when one is tapped.
//
// 没网也能打开 (src/web/offline.ts): every request still goes to the network first, so online the
// site loads as it does without this. What comes back is kept, and stands in when the network fails
// or takes too long: the page itself, its code and pictures, and what a member's own pages asked
// for (never the 管理页's data). The page says so in a line at the top.

const SHELL = "shell-v1";
const STATIC = "static-v1";
const DATA = "data-v1"; // keep in step with src/web/offline.ts, which empties it on signing out
const SHELL_KEY = "/__shell";
const STATIC_MAX = 120;
const PAGE_WAIT_MS = 4000;
const DATA_WAIT_MS = 6000;
// The first answers written into the page (src/worker/boot.ts) say who is signed in: not kept.
const BOOT = /<script type="application\/json" id="boot">[\s\S]*?<\/script>/;

// Only once the page has asked for it (offline.ts): the browser tests answer the page's requests
// themselves, and must keep doing so after one of them turns push on.
const SWITCH = "offline-on";
let on = false;
const switched = caches
  .has(SWITCH)
  .then((has) => {
    on = on || has;
  })
  .catch(() => {});
self.addEventListener("message", (event) => {
  if (event.data?.offline) on = true;
});

const isData = (path) => path === "/api/auth/session" || path.startsWith("/api/public/") || path.startsWith("/api/m/");

/** The answer if it comes in time; otherwise whatever fallback() finds, and failing that the answer after all. */
async function inTime(fetched, ms, fallback) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("slow")), ms);
  });
  try {
    return await Promise.race([fetched, late]);
  } catch {
    return (await fallback()) ?? fetched;
  } finally {
    clearTimeout(timer);
  }
}

async function keepShell(res) {
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return;
  const html = (await res.text()).replace(BOOT, "");
  if (!html.includes('id="app"')) return;
  const cache = await caches.open(SHELL);
  await cache.put(SHELL_KEY, new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
}

async function keepStatic(req, res) {
  if (!res.ok) return;
  const cache = await caches.open(STATIC);
  await cache.put(req, res);
  const keys = await cache.keys();
  // Oldest first: code from releases long gone makes way.
  for (const old of keys.slice(0, Math.max(0, keys.length - STATIC_MAX))) await cache.delete(old);
}

async function keepData(req, res) {
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return;
  const headers = new Headers(res.headers);
  headers.set("X-Kept-At", String(Date.now()));
  await (await caches.open(DATA)).put(req, new Response(await res.blob(), { status: 200, headers }));
}

/** What was kept, marked with when (X-Stale), so the page can say what it is showing. */
async function keptData(req) {
  const kept = await (await caches.open(DATA)).match(req);
  if (!kept) return undefined;
  const headers = new Headers(kept.headers);
  headers.set("X-Stale", kept.headers.get("X-Kept-At") ?? "0");
  return new Response(kept.body, { status: 200, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  const api = url.pathname.startsWith("/api/");
  if (req.mode === "navigate") {
    if (api) return; // Google sign-in and the like
    // Opening the page may be what woke this worker: wait to know whether it is switched on.
    event.respondWith(
      (async () => {
        await switched;
        const fetched = fetch(req);
        if (!on) return fetched;
        event.waitUntil(fetched.then((res) => keepShell(res.clone())).catch(() => {}));
        return inTime(fetched, PAGE_WAIT_MS, async () => (await caches.open(SHELL)).match(SHELL_KEY));
      })(),
    );
  } else if (!on) {
    return;
  } else if (api) {
    if (!isData(url.pathname)) return;
    const fetched = fetch(req);
    event.waitUntil(fetched.then((res) => keepData(req, res.clone())).catch(() => {}));
    event.respondWith(inTime(fetched, DATA_WAIT_MS, () => keptData(req)));
  } else if (url.pathname.startsWith("/assets/")) {
    // Named after their content: what was kept is the file.
    event.respondWith(
      (async () => {
        const kept = await (await caches.open(STATIC)).match(req);
        if (kept) return kept;
        const res = await fetch(req);
        event.waitUntil(keepStatic(req, res.clone()).catch(() => {}));
        return res;
      })(),
    );
  } else {
    const fetched = fetch(req);
    event.waitUntil(fetched.then((res) => keepStatic(req, res.clone())).catch(() => {}));
    event.respondWith(inTime(fetched, PAGE_WAIT_MS, async () => (await caches.open(STATIC)).match(req)));
  }
});

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
        if (new URL(client.url).pathname !== url.pathname || !("focus" in client)) continue;
        // A 结算提醒 names one event: the open 管理页 goes there itself (adminNav.ts), keeping its history.
        if (url.search && new URL(client.url).search !== url.search)
          client.postMessage({ open: url.pathname + url.search });
        return client.focus();
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
