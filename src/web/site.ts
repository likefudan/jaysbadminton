import { useEffect, useState } from "preact/hooks";
import { DEFAULT_THEME, isTheme, normalizeTheme, themeById, type ThemeId } from "../shared/themes";
import { api } from "./api";

// The site title and default appearance are admin settings, fetched once per page load and shared
// by every page. Each visitor may also pick their own appearance and light/dark mode; that choice
// lives only in this browser. index.html applies the cached values before anything renders.
const TITLE_KEY = "site-title";
const SITE_THEME_KEY = "site-theme";
const MY_THEME_KEY = "my-theme";
const MY_MODE_KEY = "my-mode";
const DEFAULT = "Jay's 羽毛球";

export type Mode = "auto" | "light" | "dark";

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: the value still applies for this visit.
  }
}

let current = read(TITLE_KEY, DEFAULT);
const listeners = new Set<(t: string) => void>();
let loading: Promise<void> | null = null;

let staging = false;
const stagingListeners = new Set<(s: boolean) => void>();

// The site's own icon colour (sites.json "icon"), e.g. "blue"; null on production's coral.
let icon: string | null = null;
const iconListeners = new Set<(i: string | null) => void>();

// Who sponsors the AI, thanked in the footer: null until /api/public/site answers, or when no one does.
export type Sponsor = { name: string; url: string | null };
let sponsor: Sponsor | null = null;
const sponsorListeners = new Set<(s: Sponsor | null) => void>();

// 入群不需要审核: while on, the join pages don't promise a review.
let autoJoin = false;
const autoJoinListeners = new Set<(on: boolean) => void>();

function load() {
  if (!loading)
    loading = api<{
      title: string;
      theme: string;
      staging?: boolean;
      icon?: string | null;
      sponsor?: Sponsor | null;
      autoJoin?: boolean;
    }>("/api/public/site")
      .then((r) => {
        setSiteTitle(r.title);
        setSiteTheme(r.theme);
        staging = !!r.staging;
        if (staging)
          document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((icon) => {
            icon.href = "/favicon-staging.svg";
            icon.type = "image/svg+xml";
            icon.removeAttribute("sizes");
          });
        stagingListeners.forEach((l) => l(staging));
        icon = r.icon ?? null;
        iconListeners.forEach((l) => l(icon));
        sponsor = r.sponsor ?? null;
        sponsorListeners.forEach((l) => l(sponsor));
        autoJoin = !!r.autoJoin;
        autoJoinListeners.forEach((l) => l(autoJoin));
      })
      .catch(() => {
        // The defaults stand: the site's name and theme just stay as they were.
      });
}

/** True on the test site (staging.…), which shows a banner so its links are never mistaken for real ones. */
export function useStaging(): boolean {
  const [s, setS] = useState(staging);
  useEffect(() => {
    stagingListeners.add(setS);
    load();
    return () => void stagingListeners.delete(setS);
  }, []);
  return s;
}

/** The site's own icon colour for the top-bar logo, e.g. "blue"; null for the usual one. */
export function useSiteIcon(): string | null {
  const [i, setI] = useState(icon);
  useEffect(() => {
    iconListeners.add(setI);
    load();
    setI(icon);
    return () => void iconListeners.delete(setI);
  }, []);
  return i;
}

/** Whether 入群不需要审核 is on: 申请加入 then makes a member at once. */
export function useAutoJoin(): boolean {
  const [on, setOn] = useState(autoJoin);
  useEffect(() => {
    autoJoinListeners.add(setOn);
    load();
    setOn(autoJoin);
    return () => void autoJoinListeners.delete(setOn);
  }, []);
  return on;
}

/** The AI sponsor to thank in the footer, or null. */
export function useSponsor(): Sponsor | null {
  const [s, setS] = useState(sponsor);
  useEffect(() => {
    sponsorListeners.add(setS);
    load();
    return () => void sponsorListeners.delete(setS);
  }, []);
  return s;
}

export function setSiteTitle(title: string) {
  current = title;
  write(TITLE_KEY, title);
  listeners.forEach((l) => l(title));
}

export function useSiteTitle(): string {
  const [title, setTitle] = useState(current);
  useEffect(() => {
    listeners.add(setTitle);
    load();
    return () => void listeners.delete(setTitle);
  }, []);
  return title;
}

// ---- Appearance ----

export interface Appearance {
  site: ThemeId; // the Owner's default
  mine: ThemeId | null; // this visitor's override
  mode: Mode;
}

let look: Appearance = {
  site: normalizeTheme(read(SITE_THEME_KEY, DEFAULT_THEME)),
  mine: isTheme(read(MY_THEME_KEY, "")) ? (read(MY_THEME_KEY, "") as ThemeId) : null,
  mode: (["light", "dark"].includes(read(MY_MODE_KEY, "")) ? read(MY_MODE_KEY, "") : "auto") as Mode,
};
const lookListeners = new Set<(a: Appearance) => void>();
const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

/** Puts the effective style, accent and light/dark on <html>, and tints the browser bar to match. */
function apply() {
  const t = themeById(look.mine ?? look.site);
  const dark = look.mode === "dark" || (look.mode === "auto" && !!darkQuery?.matches);
  const root = document.documentElement;
  root.dataset.style = t.style;
  root.dataset.accent = t.accent;
  root.dataset.mode = dark ? "dark" : "light";
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  lookListeners.forEach((l) => l(look));
}
// Follow the phone switching between light and dark while the page is open.
// Older iOS WebViews only have the deprecated addListener.
const onSchemeChange = () => look.mode === "auto" && apply();
if (darkQuery?.addEventListener) darkQuery.addEventListener("change", onSchemeChange);
else darkQuery?.addListener?.(onSchemeChange);

function update(next: Partial<Appearance>) {
  look = { ...look, ...next };
  write(SITE_THEME_KEY, look.site);
  write(MY_THEME_KEY, look.mine ?? "");
  write(MY_MODE_KEY, look.mode === "auto" ? "" : look.mode);
  apply();
}

/** The Owner's default, from the server or from a change in settings. */
export function setSiteTheme(theme: string) {
  update({ site: normalizeTheme(theme) });
}
/** This visitor's own look; null goes back to the site default. */
export function setMyTheme(theme: ThemeId | null) {
  update({ mine: theme });
}
export function setMyMode(mode: Mode) {
  update({ mode });
}

export function useAppearance(): Appearance {
  const [a, setA] = useState(look);
  useEffect(() => {
    lookListeners.add(setA);
    return () => void lookListeners.delete(setA);
  }, []);
  return a;
}

apply();
