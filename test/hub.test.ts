import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker/index";
import { ORIGIN, appoint, createTestEvent, googleJoin, setUpAdmin } from "./helpers";

/** What a group's site tells the 总入口 about one Google account (src/worker/hub.ts). */
const HUB = "https://hub.test";
const withHub = { ...env, HUB_ORIGIN: HUB, SITE_ORIGIN: ORIGIN, ORGANIZERS: "1" };

let privateKey: CryptoKey, jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "hub-test", alg: "ES256", use: "sig" };
});
beforeEach(() => {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${HUB}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    if (url.startsWith("https://api.telegram.org/")) return Response.json({ ok: true, result: { message_id: 1 } });
    return real(input as RequestInfo, init);
  });
});
afterEach(() => vi.restoreAllMocks());

async function question(
  email: string,
  o: { aud?: string; iss?: string; iat?: number; key?: CryptoKey; claims?: Record<string, unknown> } = {},
) {
  return new SignJWT({ email, ...o.claims })
    .setProtectedHeader({ alg: "ES256", kid: "hub-test" })
    .setIssuer(o.iss ?? HUB)
    .setAudience(o.aud ?? ORIGIN)
    .setIssuedAt(o.iat)
    .setExpirationTime("2m")
    .sign(o.key ?? privateKey);
}

async function ask(token: string | null, bindings: object = withHub) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/api/hub/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
    bindings as typeof env,
    {} as ExecutionContext,
  );
  return { status: res.status, data: (await res.json()) as any };
}

describe("what a site tells the 总入口", () => {
  it("is off until the site is given the 总入口's address", async () => {
    expect((await ask(await question("alice@gmail.com"), { ...env, HUB_ORIGIN: undefined })).status).toBe(404);
  });

  it("refuses questions the 总入口 didn't sign for this site", async () => {
    await setUpAdmin();
    expect((await ask(null)).status).toBe(401);
    expect((await ask("nonsense")).status).toBe(401);
    expect((await ask(await question("a@gmail.com", { aud: "https://other.test" }))).status).toBe(401);
    expect((await ask(await question("a@gmail.com", { iss: "https://evil.test" }))).status).toBe(401);
    expect((await ask(await question("a@gmail.com", { iat: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401);
    const other = (await generateKeyPair("ES256")).privateKey;
    expect((await ask(await question("a@gmail.com", { key: other }))).status).toBe(401);
  });

  it("knows nobody for an account that never joined", async () => {
    await setUpAdmin();
    const { status, data } = await ask(await question("stranger@gmail.com"));
    expect(status).toBe(200);
    expect(data.member).toBeNull();
    expect(data.events).toEqual([]);
    expect(data.site.name).toBeTruthy();
  });

  it("shows someone still waiting the group but not its events", async () => {
    const ctx = await setUpAdmin();
    await createTestEvent(ctx);
    await googleJoin("Alice", "alice-wx", { email: "alice@gmail.com" });
    const { data } = await ask(await question("Alice@Gmail.com"));
    expect(data.member).toMatchObject({ name: "Alice", pending: true });
    expect(data.events).toEqual([]);
  });

  it("lists a member's coming events, whether they are on them, and their role", async () => {
    const ctx = await setUpAdmin();
    const joined = await googleJoin("Alice", "alice-wx", { email: "alice@gmail.com" });
    expect((await ctx.admin.call(`${ctx.base}/members/${joined.data.id}/approve`, {})).status).toBe(200);
    const event = await createTestEvent(ctx);
    let { data } = await ask(await question("alice@gmail.com"));
    expect(data.member).toEqual({ name: "Alice", pending: false, role: "member", unpaidCents: 0 });
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({ code: event.code, status: "open", signedUp: false, headcount: 0 });
    expect(data.events[0].date).toMatch(/^\d{4}-\d\d-\d\d$/);

    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/m/session/events/${event.id}/signup`, {
        method: "POST",
        headers: { Cookie: joined.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ friends: [] }),
      }),
      withHub as typeof env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    await appoint(joined.data.id, "Alice", "organizer");
    ({ data } = await ask(await question("alice@gmail.com")));
    expect(data.events[0]).toMatchObject({ signedUp: true, headcount: 1 });
    expect(data.member.role).toBe("organizer");
  });
});
