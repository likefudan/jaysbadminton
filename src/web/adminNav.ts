import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

/**
 * Where one is on the 管理页, kept in the address (Ke Li 2026-11-11, thread "统一管理页返回跳转"):
 * ?tab=events&event=12, ?tab=events&event=new, ?tab=members&member=…, ?tab=settings&sub=pay.
 *
 * Every page one taps into gets a history entry of its own, so 「‹」 on the page, the browser's
 * back, the iPhone's edge swipe and Android's back button all go up one level (before, only the
 * full-screen panels did: on the others the swipe left the whole 管理页). A reload or 下拉刷新
 * stays where one was, and a push can open one event. Switching tabs replaces the entry instead,
 * so going back does not walk through the tabs; tapping the tab one is on goes back to its first page.
 */
export type AdminTab = "events" | "inbound" | "pending" | "members" | "settings";
export type AdminLoc = { tab: AdminTab; event?: number | "new"; member?: string; sub?: string };

const TABS: AdminTab[] = ["events", "inbound", "pending", "members", "settings"];

export function readLoc(search = location.search): AdminLoc {
  const q = new URLSearchParams(search);
  const tab = TABS.includes(q.get("tab") as AdminTab) ? (q.get("tab") as AdminTab) : "events";
  const loc: AdminLoc = { tab };
  const event = q.get("event");
  if (tab === "events" && event) {
    if (event === "new") loc.event = "new";
    else if (/^\d+$/.test(event)) loc.event = Number(event);
  }
  const member = q.get("member");
  if (tab === "members" && member) loc.member = member;
  const sub = q.get("sub");
  if (tab === "settings" && sub) loc.sub = sub;
  return loc;
}

function href(loc: AdminLoc): string {
  const q = new URLSearchParams();
  // Other parameters (none today) are dropped: the address only says where one is.
  if (loc.tab !== "events" || loc.event !== undefined) q.set("tab", loc.tab);
  if (loc.event !== undefined) q.set("event", String(loc.event));
  if (loc.member) q.set("member", loc.member);
  if (loc.sub) q.set("sub", loc.sub);
  const s = q.toString();
  return `${location.pathname}${s ? `?${s}` : ""}${location.hash}`;
}

/** How many levels down this history entry is from the tab's first page (0 there, or when opened straight into it). */
const depth = (): number => (typeof history.state?.adminDepth === "number" ? history.state.adminDepth : 0);

let current: AdminLoc = typeof location === "undefined" ? { tab: "events" } : readLoc();
/** Where to land once the history.go() of goRoot() arrives. */
let landing: AdminLoc | null = null;
const listeners = new Set<() => void>();

function set(loc: AdminLoc, scroll: number) {
  current = loc;
  for (const f of listeners) f();
  // After the page below has drawn, so the list is there to scroll to.
  requestAnimationFrame(() => window.scrollTo(0, scroll));
}

function onPop() {
  if (landing) {
    const to = landing;
    landing = null;
    history.replaceState({ ...(history.state ?? {}), adminDepth: 0, adminScroll: 0 }, "", href(to));
    set(to, 0);
    return;
  }
  const next = readLoc();
  // A panel's own entry (same address) coming and going changes nothing here.
  if (href(next) === href(current)) return;
  set(next, typeof history.state?.adminScroll === "number" ? history.state.adminScroll : 0);
}

/** One level down: a new history entry, at the top of the new page. */
export function goDown(loc: AdminLoc) {
  if (href(loc) === href(current)) return; // a double tap
  // Where this page was scrolled to, for coming back.
  history.replaceState({ ...(history.state ?? {}), adminScroll: window.scrollY }, "");
  history.pushState({ adminDepth: depth() + 1 }, "", href(loc));
  set(loc, 0);
}

/** One level up, to `parent`: back through history when we came down that way, else in place. */
export function goUp(parent: AdminLoc) {
  if (depth() > 0) history.back();
  else {
    history.replaceState({ adminDepth: 0 }, "", href(parent));
    set(parent, 0);
  }
}

/** In place of this page, e.g. 新建活动 becoming the new event's page. */
export function goReplace(loc: AdminLoc) {
  history.replaceState({ adminDepth: depth() }, "", href(loc));
  set(loc, 0);
}

/** A tab's first page: back to the bottom of what we came down through, then that tab in its place. */
export function goRoot(loc: AdminLoc) {
  const d = depth();
  if (d > 0) {
    landing = loc;
    history.go(-d);
    return;
  }
  history.replaceState({ ...(history.state ?? {}), adminDepth: 0, adminScroll: 0 }, "", href(loc));
  set(loc, 0);
}

/** Calls `reload` when `top` turns true again: the page above came back up with what changed below. */
export function useOnReturn(top: boolean, reload: () => void) {
  const was = useRef(top);
  useEffect(() => {
    if (!was.current && top) reload();
    was.current = top;
  }, [top]);
}

/** A 结算提醒 tapped while the 管理页 is open (sw.js): that event, without reloading the page. */
function onWorkerMessage(e: MessageEvent) {
  const open = e.data?.open;
  if (typeof open !== "string") return;
  const url = new URL(open, location.origin);
  if (url.pathname === location.pathname) goDown(readLoc(url.search));
}

let listening = false;

export function useAdminLoc(): AdminLoc {
  // Afresh for each 管理页 opened: this module may have loaded on another page.
  useState(() => {
    current = readLoc();
    landing = null;
  });
  const [, render] = useState(0);
  useLayoutEffect(() => {
    const f = () => render((n) => n + 1);
    listeners.add(f);
    if (!listening) {
      listening = true;
      addEventListener("popstate", onPop);
      navigator.serviceWorker?.addEventListener("message", onWorkerMessage);
      navigator.serviceWorker?.startMessages();
    }
    return () => {
      listeners.delete(f);
      if (!listeners.size) {
        listening = false;
        removeEventListener("popstate", onPop);
        navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
      }
    };
  }, []);
  return current;
}
