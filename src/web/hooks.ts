import { useEffect, useState } from "preact/hooks";
import { ApiError, api } from "./api";

export type Loaded<T> =
  | { state: "loading" }
  /** `path`: what was asked for, so a page can tell a result from before it changed the path. */
  | { state: "error"; message: string; code: string; path?: string }
  | { state: "ok"; data: T; path?: string };

/**
 * Every page's data loads once, so a page left open (above all the app on the home screen, which
 * has no reload and stays open for days) would keep showing old sign-ups. refreshAll() loads it
 * all again in place: on coming back to the page after a while, and on 下拉刷新.
 */
const refreshers = new Set<() => void>();
let inflight = 0;
const watchers = new Set<(busy: boolean) => void>();
function settle(delta: number) {
  inflight += delta;
  for (const f of watchers) f(inflight > 0);
}
export function refreshAll() {
  for (const f of refreshers) f();
}
/** Whether a refreshAll() is still loading, for the 下拉刷新 indicator. */
export function onRefreshing(f: (busy: boolean) => void) {
  watchers.add(f);
  return () => {
    watchers.delete(f);
  };
}

const STALE_AFTER_MS = 30_000;
if (typeof document !== "undefined") {
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_MS) refreshAll();
  });
  // Back/forward restored from the browser's page cache.
  addEventListener("pageshow", (e) => e.persisted && refreshAll());
}

export function useApi<T>(path: string): [Loaded<T>, () => void] {
  const [result, setResult] = useState<Loaded<T>>({ state: "loading" });
  // quiet: a refreshAll(), which keeps what's shown if it fails or nothing changed.
  const [tick, setTick] = useState({ n: 0, quiet: false });
  useEffect(() => {
    const refresh = () => setTick((t) => ({ n: t.n + 1, quiet: true }));
    refreshers.add(refresh);
    return () => {
      refreshers.delete(refresh);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const quiet = tick.quiet;
    if (quiet) settle(1);
    api<T>(path)
      .then(
        (data) =>
          alive &&
          setResult((r) =>
            quiet && r.state === "ok" && r.path === path && JSON.stringify(r.data) === JSON.stringify(data)
              ? r
              : { state: "ok", data, path },
          ),
      )
      .catch(
        (e: Error) =>
          alive &&
          setResult((r) =>
            quiet && r.state === "ok"
              ? r
              : { state: "error", message: e.message, code: e instanceof ApiError ? e.code : "", path },
          ),
      )
      .finally(() => quiet && settle(-1));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  return [result, () => setTick((t) => ({ n: t.n + 1, quiet: false }))];
}

/** Who this browser is, by its Google session: a member, an applicant waiting for approval, or nobody yet. */
export function useMemberSession(): "loading" | "none" | "pending" | "member" {
  const [session] = useApi<{ signedIn: boolean; hasMember: boolean; pending: boolean }>("/api/auth/session");
  if (session.state === "loading") return "loading";
  if (session.state === "error" || !session.data.signedIn) return "none";
  return session.data.hasMember ? "member" : session.data.pending ? "pending" : "none";
}
