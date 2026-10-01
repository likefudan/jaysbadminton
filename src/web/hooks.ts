import { useEffect, useState } from "preact/hooks";
import { api } from "./api";

export type Loaded<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };

export function useApi<T>(path: string): [Loaded<T>, () => void] {
  const [result, setResult] = useState<Loaded<T>>({ state: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setResult({ state: "loading" });
    api<T>(path)
      .then((data) => alive && setResult({ state: "ok", data }))
      .catch((e: Error) => alive && setResult({ state: "error", message: e.message }));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  return [result, () => setTick((t) => t + 1)];
}
