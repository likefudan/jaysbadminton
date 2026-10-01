import { useEffect, useState } from "preact/hooks";
import { DEFAULT_THEME, THEMES } from "../shared/themes";
import { api } from "./api";

// The site title and colour theme are admin settings. They are fetched once per page load and
// shared by every page; the last values are cached so repeat visits show them immediately
// (index.html applies the cached theme before anything renders).
const TITLE_KEY = "site-title";
const THEME_KEY = "site-theme";
const DEFAULT = "Jay's 羽毛球";

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the value still applies for this visit.
  }
}

let current = read(TITLE_KEY, DEFAULT);
const listeners = new Set<(t: string) => void>();
let loading: Promise<void> | null = null;

function load() {
  loading ??= api<{ title: string; theme: string }>("/api/public/site")
    .then((r) => {
      setSiteTitle(r.title);
      applyTheme(r.theme);
    })
    .catch(() => undefined);
}

export function setSiteTitle(title: string) {
  current = title;
  write(TITLE_KEY, title);
  listeners.forEach((l) => l(title));
}

/** Switches the palette now and remembers it; also tints the iOS status bar to match. */
export function applyTheme(theme: string) {
  const t = THEMES.find((x) => x.id === theme) ?? THEMES.find((x) => x.id === DEFAULT_THEME)!;
  document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.swatch[0]);
  write(THEME_KEY, t.id);
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
