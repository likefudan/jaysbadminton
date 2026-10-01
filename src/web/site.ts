import { useEffect, useState } from "preact/hooks";
import { api } from "./api";

// The site title is an admin setting. It is fetched once per page load and shared by every
// page; the last value is cached so repeat visits show it immediately.
const CACHE_KEY = "site-title";
const DEFAULT = "Jay's 羽毛球";

function cached(): string {
  try {
    return localStorage.getItem(CACHE_KEY) || DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current = cached();
const listeners = new Set<(t: string) => void>();
let loading: Promise<void> | null = null;

function load() {
  loading ??= api<{ title: string }>("/api/public/site")
    .then((r) => setSiteTitle(r.title))
    .catch(() => undefined);
}

export function setSiteTitle(title: string) {
  current = title;
  try {
    localStorage.setItem(CACHE_KEY, title);
  } catch {
    // Private mode or blocked storage: the title still updates for this visit.
  }
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
