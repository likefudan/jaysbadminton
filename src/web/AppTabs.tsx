import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { standalone } from "./Install";
import { useApi } from "./hooks";
import { isAdminPath, t, tk } from "./i18n";

type Tab = "events" | "boards" | "me" | "manage";

type Session = { signedIn: boolean; hasMember?: boolean; pending?: boolean; role?: string };

/**
 * Which tabs the bottom tab bar shows here, or null for none. Only in the app added to the home
 * screen (Ke Li 2026-11-14): a browser keeps the tabs at the top, since Safari has its own
 * toolbar at the bottom. Only for someone signed in with Google, and only with two tabs or more.
 */
export function useAppTabs(): Tab[] | null {
  const [session] = useApi<Session>("/api/auth/session");
  if (!standalone() || session.state !== "ok" || !session.data.signedIn) return null;
  const s = session.data;
  const tabs: Tab[] = s.hasMember && !s.pending ? ["events", "boards", "me"] : [];
  if (s.role && s.role !== "member") tabs.push("manage");
  return tabs.length > 1 ? tabs : null;
}

/** The tab a page belongs to: an event's page to 活动, the legal pages to 我的. */
export function tabOf(path: string): Tab | null {
  if (isAdminPath(path)) return "manage";
  if (path === "/me/boards") return "boards";
  if (path === "/me/profile" || path === "/privacy" || path === "/terms") return "me";
  if (path === "/" || path === "/me" || path.startsWith("/e/")) return "events";
  return null;
}

const HREF: Record<Tab, string> = { events: "/me", boards: "/me/boards", me: "/me/profile", manage: "/admin/google" };
const LABEL: Record<Tab, string> = { events: tk("活动"), boards: tk("排行榜"), me: tk("我的"), manage: tk("管理") };

/** 活动 · 排行榜 · 我的, and 管理 for the Owner, admins and organizers: at the bottom, as in an app. */
export function AppTabs(props: { tabs: Tab[] }) {
  const { path } = useLocation();
  const current = tabOf(path);
  const away = useAwayOnScroll(path);
  return (
    <nav class={`app-tabs${away ? " away" : ""}`} aria-label={t("主导航")}>
      {props.tabs.map((k) => (
        <a
          key={k}
          href={HREF[k]}
          class={k === current ? "on" : ""}
          aria-current={k === current ? "page" : undefined}
          onClick={() => k === current && window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <TabIcon tab={k} />
          <span>{t(LABEL[k])}</span>
        </a>
      ))}
    </nav>
  );
}

/** How far the page must move one way before the tabs follow, so a shaky finger doesn't flicker them. */
const STEP = 10;

/**
 * True while the tabs are slid away: the finger pushes the page up (reading on) and they go down
 * out of sight; it pulls the page down and they come back (Ke Li 2026-11-18). Always shown near the
 * top of the page and on a new page. The bounce past either end of the page is ignored.
 */
function useAwayOnScroll(path: string): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    setAway(false);
    let last = window.scrollY;
    let hidden = false;
    const set = (v: boolean) => {
      if (v === hidden) return;
      hidden = v;
      setAway(v);
    };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = Math.min(Math.max(window.scrollY, 0), Math.max(max, 0));
      if (y < 40) {
        last = y;
        set(false);
        return;
      }
      const dy = y - last;
      if (Math.abs(dy) < STEP) return;
      last = y;
      set(dy > 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [path]);
  // The queue's legend at the bottom of the screen moves down with the tabs.
  useEffect(() => {
    document.documentElement.classList.toggle("tabs-away", away);
    return () => document.documentElement.classList.remove("tabs-away");
  }, [away]);
  return away;
}

function TabIcon(props: { tab: Tab }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="25"
      height="25"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {ICONS[props.tab]}
    </svg>
  );
}

const ICONS: Record<Tab, ComponentChildren> = {
  events: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  boards: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.6M17 6h2.5a2.5 2.5 0 0 1-2.6 3.6M12 14v3.5M8.5 20.5h7M9.5 17.5h5" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5c1.3-3.7 4.2-5.5 7.5-5.5s6.2 1.8 7.5 5.5" />
    </>
  ),
  manage: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
};
