import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker/index";

/**
 * Signing in inside the phone apps (googleAuth.ts, POST /api/auth/native/google): the app signs in
 * with the phone's Google account and hands the page the ID token.
 */
const ORIGIN = "https://jaysbadminton.test";
const web = { ...env, GOOGLE_CLIENT_ID: "web-client", GOOGLE_CLIENT_SECRET: "test-secret", SITE_ORIGIN: ORIGIN };
const withApps = { ...web, GOOGLE_NATIVE_CLIENT_IDS: "ios-client, android-client" };

const post = (bindings: object, body: unknown, origin = ORIGIN) =>
  worker.fetch(
    new Request(`${ORIGIN}/api/auth/native/google`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    bindings as typeof env,
    {} as ExecutionContext,
  );

let privateKey: CryptoKey, jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "google-native-test", alg: "RS256", use: "sig" };
});
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

async function idToken(o: { aud?: string; azp?: string; iat?: number; claims?: Record<string, unknown> } = {}) {
  return new SignJWT({ email: "alice@gmail.com", email_verified: true, ...(o.azp ? { azp: o.azp } : {}), ...o.claims })
    .setProtectedHeader({ alg: "RS256", kid: "google-native-test" })
    .setSubject("google-alice")
    .setIssuer("https://accounts.google.com")
    .setAudience(o.aud ?? "ios-client")
    .setIssuedAt(o.iat)
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function signedIn(res: Response) {
  const cookie = res.headers.get("Set-Cookie")?.match(/jb_member=([^; ,]+)/)?.[0] ?? "";
  if (!cookie) return false;
  const s = await worker.fetch(
    new Request(`${ORIGIN}/api/auth/session`, { headers: { Cookie: cookie } }),
    web as typeof env,
    {} as ExecutionContext,
  );
  const data = (await s.json()) as { signedIn: boolean; email: string };
  return data.signedIn && data.email === "alice@gmail.com";
}

describe("signing in inside a phone app", () => {
  it("is off until the apps' client IDs are set", async () => {
    const res = await post(web, { idToken: await idToken() });
    expect(res.status).toBe(404);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("signs in with an iPhone's token and an Android one", async () => {
    const ios = await post(withApps, { idToken: await idToken() });
    expect(ios.status).toBe(200);
    expect(ios.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(await signedIn(ios)).toBe(true);
    // Android: made out to the website, on behalf of the app.
    const android = await post(withApps, { idToken: await idToken({ aud: "web-client", azp: "android-client" }) });
    expect(await signedIn(android)).toBe(true);
  });

  it("refuses tokens that aren't for the apps, are old, unverified or from another site", async () => {
    const refused = async (token: string, origin?: string, status = 401) => {
      const res = await post(withApps, { idToken: token }, origin);
      expect(res.status).toBe(status);
      expect(res.headers.get("Set-Cookie")).toBeNull();
    };
    await refused(await idToken({ aud: "someone-else" }));
    // The website's own token (a browser sign-in), not an app's.
    await refused(await idToken({ aud: "web-client" }));
    await refused(await idToken({ aud: "web-client", azp: "web-client" }));
    await refused(await idToken({ iat: Math.floor(Date.now() / 1000) - 900 }));
    await refused(await idToken({ claims: { email_verified: false } }));
    await refused("not-a-token");
    await refused(await idToken(), "https://evil.example", 403);
  });
});
