import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker/index";
import { joinBody } from "./helpers";

const ORIGIN = "https://jaysbadminton.test";
const bindings = (extra: Record<string, unknown> = {}) => ({
  ...env,
  SITE_ORIGIN: ORIGIN,
  TURNSTILE_SITE_KEY: "test-site-key",
  TURNSTILE_SECRET: "test-turnstile-secret",
  ...extra,
});
const request = (path: string, body?: unknown, extra: Record<string, unknown> = {}) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    bindings(extra),
    {} as ExecutionContext,
  );

/** Siteverify that accepts `good` once, for the given action and hostname, like the real one. */
function siteverify(answer: Record<string, unknown> | "down" = {}) {
  const seen: URLSearchParams[] = [];
  const used = new Set<string>();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") throw new Error(String(input));
    if (answer === "down") return new Response("oops", { status: 500 });
    const form = new URLSearchParams(String(init?.body));
    seen.push(form);
    const ok = form.get("response") === "good" && !used.has("good");
    used.add(form.get("response")!);
    return Response.json({
      success: ok,
      action: "join",
      hostname: "jaysbadminton.test",
      "error-codes": ok ? [] : ["invalid-input-response"],
      ...(ok ? answer : {}),
    });
  });
  return seen;
}

afterEach(() => vi.restoreAllMocks());

describe("Turnstile on the public forms", () => {
  it("is off, and the site key not sent, until the secret is set", async () => {
    const off = await request("/api/public/site", undefined, { TURNSTILE_SECRET: undefined });
    expect(((await off.json()) as any).turnstileSiteKey).toBeNull();
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await request("/api/public/join", joinBody("Offline", "o"), { TURNSTILE_SECRET: undefined });
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it("gives the pages the site key once it is on", async () => {
    const res = await request("/api/public/site");
    expect(((await res.json()) as any).turnstileSiteKey).toBe("test-site-key");
  });

  it("lets a join through with a passing token, sending the secret and the visitor's IP", async () => {
    const seen = siteverify();
    const res = await request("/api/public/join", joinBody("Human", "h", { turnstileToken: "good" }));
    expect(res.status).toBe(200);
    expect(seen[0]!.get("secret")).toBe("test-turnstile-secret");
    expect(seen[0]!.get("remoteip")).toBe("203.0.113.7");
  });

  it("refuses a join with no token, a bad one or a replayed one, and creates nobody", async () => {
    siteverify();
    expect((await request("/api/public/join", joinBody("NoToken", "n"))).status).toBe(403);
    expect((await request("/api/public/join", joinBody("BadToken", "b", { turnstileToken: "bad" }))).status).toBe(403);
    expect((await request("/api/public/join", joinBody("First", "f", { turnstileToken: "good" }))).status).toBe(200);
    const replay = await request("/api/public/join", joinBody("Replay", "r", { turnstileToken: "good" }));
    expect(replay.status).toBe(403);
    expect(((await replay.json()) as any).error.code).toBe("turnstile_failed");
    const names = await env.DB.prepare(
      "SELECT username FROM members WHERE username IN ('NoToken', 'BadToken', 'Replay')",
    ).all();
    expect(names.results).toEqual([]);
  });

  it("refuses a token solved for another form or on another site", async () => {
    siteverify({ action: "recover_link" });
    expect((await request("/api/public/join", joinBody("Wrong", "w", { turnstileToken: "good" }))).status).toBe(403);
    vi.restoreAllMocks();
    siteverify({ hostname: "localhost" });
    expect((await request("/api/public/join", joinBody("Local", "l", { turnstileToken: "good" }))).status).toBe(403);
  });

  it("refuses when Siteverify can't be reached", async () => {
    siteverify("down");
    expect((await request("/api/public/join", joinBody("Down", "d", { turnstileToken: "good" }))).status).toBe(403);
  });

  it("checks 找回链接 with its own action", async () => {
    siteverify({ action: "recover_link" });
    const body = { email: "nobody@example.com" };
    expect((await request("/api/public/recover-link", body)).status).toBe(403);
    expect((await request("/api/public/recover-link", { ...body, turnstileToken: "good" })).status).toBe(200);
  });

  it("still drops a filled-in honeypot without asking Siteverify", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await request("/api/public/join", joinBody("Bot", "b", { website: "spam.example" }));
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
