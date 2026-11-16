import { useEffect, useState } from "preact/hooks";

/**
 * 没网也能打开 (Ke Li 2026-11-15). sw.js keeps the page, its code and what a member's own pages
 * asked for, and hands them back when the network fails; this file is the page's side of it: the
 * line saying what is being shown, the last answers shown at once in the app on the home screen,
 * and emptying what was kept when someone signs out.
 */
const DATA = "data-v1"; // keep in step with sw.js
const SWITCH = "offline-on"; // keep in step with sw.js

/** Browser tests answer the page's requests themselves, which a service worker would take over. */
export function startOffline() {
  if (!("serviceWorker" in navigator) || (navigator.webdriver && !(window as { offlineTest?: boolean }).offlineTest))
    return;
  // sw.js showed the page it had kept (the network was slow), and the site has a newer one since:
  // open again on it, at once, before anything is typed (Ke Li 2026-11-16: 抽奖菜单有时候不显示).
  navigator.serviceWorker.addEventListener("message", (e) => {
    const old = (e.data as { newPage?: string } | null)?.newPage;
    const mine = document.querySelector('script[type="module"][src]')?.getAttribute("src");
    if (old && old === mine && performance.now() < 60_000) location.reload();
  });
  navigator.serviceWorker.startMessages();
  addEventListener("load", async () => {
    try {
      // sw.js keeps nothing until told to, here and (when it starts up later) by this mark.
      await caches.open(SWITCH);
      const reg = await navigator.serviceWorker.register("/sw.js");
      (await navigator.serviceWorker.ready).active?.postMessage({ offline: true });
      reg.active?.postMessage({ offline: true });
    } catch {
      // no service worker or no storage here: the site works as before
    }
  });
}

// When the oldest answer now on the page was kept, or null with everything fresh.
let staleAt: number | null = null;
const watchers = new Set<(at: number | null) => void>();
function setStale(at: number | null) {
  if (at === staleAt) return;
  staleAt = at;
  for (const f of watchers) f(at);
}

/** Every answer to a GET passes through here: sw.js marks the ones it had kept (X-Stale). */
export function noteAnswer(res: Response) {
  const kept = res.headers.get("X-Stale");
  if (kept === null) setStale(null);
  else setStale(Math.min(staleAt ?? Number.POSITIVE_INFINITY, Number(kept) || Date.now()));
}

/** Since when the page shows kept answers, for 「没有网络，显示的是 … 的内容」. */
export function useStaleAt(): number | null {
  const [at, setAt] = useState(staleAt);
  useEffect(() => {
    setAt(staleAt);
    watchers.add(setAt);
    return () => {
      watchers.delete(setAt);
    };
  }, []);
  return at;
}

/** On signing out: the next person at this browser must not see the last one's pages. */
export async function forgetOfflineData(): Promise<void> {
  try {
    await caches.delete(DATA);
  } catch {
    // no storage (private mode): nothing was kept
  }
}

type Boot = Record<string, unknown>;
const who = (session: unknown) => (session as { email?: string | null } | undefined)?.email ?? null;

/**
 * The answers written into the page (who is signed in, the site's name) never pass sw.js: keep
 * them here, for a start without network. Someone else signed in than last time: forget the rest first.
 */
let ready: Promise<void> = Promise.resolve();
export function keepBoot(boot: Boot) {
  ready = (async () => {
    try {
      const cache = await caches.open(DATA);
      const before = await cache.match("/api/auth/session");
      if (before && who(await before.json()) !== who(boot["/api/auth/session"])) {
        await caches.delete(DATA);
      }
      const fresh = await caches.open(DATA);
      for (const [path, data] of Object.entries(boot))
        await fresh.put(
          path,
          new Response(JSON.stringify(data), {
            headers: { "Content-Type": "application/json", "X-Kept-At": String(Date.now()) },
          }),
        );
    } catch {
      // no storage: the page works as before
    }
  })();
}

/** The last answer kept for this address, to show at once while the fresh one is on its way. */
export async function lastAnswer<T>(path: string): Promise<T | undefined> {
  try {
    await ready;
    const kept = await (await caches.open(DATA)).match(path);
    return kept ? ((await kept.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}
