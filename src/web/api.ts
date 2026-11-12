import { tk } from "./i18n";

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

export function api<T>(path: string, body?: unknown): Promise<T> {
  if (body !== undefined) {
    loading.clear();
    return request<T>(path, body).finally(() => loading.clear());
  }
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
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok || data?.error) {
    throw new ApiError(
      data?.error?.code ?? "http",
      data?.error?.message ?? tk("请求失败（{status}）").replace("{status}", String(res.status)),
    );
  }
  return data as T;
}
