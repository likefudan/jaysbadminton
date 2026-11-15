import { tk } from "./i18n";
import { keepBoot, noteAnswer } from "./offline";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Several parts of a page ask for the same thing as it opens (who is signed in, above all): one
// request answers them all. Only while it is on its way, so a reload still asks afresh; and never
// one that set off before a change was saved, which may answer with how things were.
const loading = new Map<string, Promise<unknown>>();

// The first answers arrive inside the page itself (src/worker/boot.ts), so the page draws without
// waiting to ask: good for the first few seconds, and until anything is saved.
const primed = new Map<string, unknown>();
try {
  const boot = typeof document === "undefined" ? null : document.getElementById("boot");
  if (boot?.textContent) {
    const answers = JSON.parse(boot.textContent) as Record<string, unknown>;
    for (const [path, data] of Object.entries(answers)) primed.set(path, data);
    keepBoot(answers);
  }
  setTimeout(() => primed.clear(), 5000);
  // A page brought back whole from the browser's page cache had its clock stopped: ask afresh.
  addEventListener("pageshow", (e) => e.persisted && primed.clear());
} catch {
  // A page without them asks as usual.
}

export function api<T>(path: string, body?: unknown): Promise<T> {
  if (body !== undefined) {
    primed.clear();
    loading.clear();
    return request<T>(path, body).finally(() => loading.clear());
  }
  if (primed.has(path)) return Promise.resolve(primed.get(path) as T);
  let p = loading.get(path) as Promise<T> | undefined;
  if (!p) {
    const mine: Promise<T> = request<T>(path).finally(() => loading.get(path) === mine && loading.delete(path));
    p = mine;
    loading.set(path, p);
  }
  return p;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", tk("网络连接失败，请检查网络后重试"));
  }
  if (body === undefined) noteAnswer(res);
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok || data?.error) {
    throw new ApiError(
      data?.error?.code ?? "http",
      data?.error?.message ?? tk("请求失败（{status}）").replace("{status}", String(res.status)),
    );
  }
  return data as T;
}
