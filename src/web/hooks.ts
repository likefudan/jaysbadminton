import { useEffect, useState } from "preact/hooks";
import { ApiError, api } from "./api";

export type Loaded<T> =
  | { state: "loading" }
  /** `path`: what was asked for, so a page can tell a result from before it changed the path. */
  | { state: "error"; message: string; code: string; path?: string }
  | { state: "ok"; data: T; path?: string };

export function useApi<T>(path: string): [Loaded<T>, () => void] {
  const [result, setResult] = useState<Loaded<T>>({ state: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api<T>(path)
      .then((data) => alive && setResult({ state: "ok", data, path }))
      .catch(
        (e: Error) =>
          alive && setResult({ state: "error", message: e.message, code: e instanceof ApiError ? e.code : "", path }),
      );
    return () => {
      alive = false;
    };
  }, [path, tick]);
  return [result, () => setTick((t) => t + 1)];
}

/** Who this browser is, by its Google session: a member, an applicant waiting for approval, or nobody yet. */
export function useMemberSession(): "loading" | "none" | "pending" | "member" {
  const [session] = useApi<{ signedIn: boolean; hasMember: boolean; pending: boolean }>("/api/auth/session");
  if (session.state === "loading") return "loading";
  if (session.state === "error" || !session.data.signedIn) return "none";
  return session.data.hasMember ? "member" : session.data.pending ? "pending" : "none";
}
