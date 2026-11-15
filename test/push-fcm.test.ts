import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetFcmAccess } from "../src/worker/fcm";
import worker from "../src/worker/index";
import { ORIGIN, approveMember, futureDate, setUpAdmin } from "./helpers";

/** Pushes to the phone apps go through Firebase (src/worker/fcm.ts); browsers are in push.test.ts. */

const TOKEN = "dGVzdC10b2tlbg:APA91b_test-token_0123456789";

async function serviceAccount() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({
    project_id: "badminton-test",
    client_email: "push@badminton-test.example",
    private_key: pem,
  });
}

let signIns = 0;
let sent: { url: string; auth: string; message: any }[] = [];
let answer: () => Response = () => Response.json({ name: "ok" });
type TestEnv = typeof env & { FCM_SERVICE_ACCOUNT?: string };
let withFcm: TestEnv;

beforeEach(async () => {
  signIns = 0;
  sent = [];
  answer = () => Response.json({ name: "ok" });
  forgetFcmAccess();
  withFcm = { ...env, FCM_SERVICE_ACCOUNT: await serviceAccount() };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.telegram.org/"))
      return Response.json({ ok: true, result: { username: "jb_test_bot", message_id: 1 } });
    if (url === "https://oauth2.googleapis.com/token") {
      signIns++;
      const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
      const claims = JSON.parse(atob(assertion.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
      expect(claims.iss).toBe("push@badminton-test.example");
      expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
      return Response.json({ access_token: "access-1", expires_in: 3600 });
    }
    if (!url.startsWith("https://fcm.googleapis.com/v1/")) throw new Error(`unexpected fetch ${url}`);
    sent.push({
      url,
      auth: new Headers(init?.headers).get("Authorization")!,
      message: JSON.parse(String(init?.body)).message,
    });
    return answer();
  });
});
afterEach(() => vi.restoreAllMocks());

async function call(e: TestEnv, path: string, body?: unknown, cookie = "") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    e,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, data: (await res.json()) as any };
}

const subscriptions = async () =>
  (await env.DB.prepare("SELECT endpoint, member_id, p256dh FROM push_subscriptions ORDER BY endpoint").all()).results;

describe("push to a phone app", () => {
  it("is refused until the site has a Firebase account", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    expect((await call(env, `${alice.base}/push`)).data.app).toBe(false);
    expect((await call(env, `${alice.base}/push/subscribe`, { fcmToken: TOKEN })).status).toBe(400);
    expect(await subscriptions()).toEqual([]);
  });

  it("keeps the app's token and sends its first push through Firebase", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    expect((await call(withFcm, `${alice.base}/push`)).data.app).toBe(true);
    expect((await call(withFcm, `${alice.base}/push/subscribe`, { fcmToken: "bad token!" })).status).toBe(400);
    expect((await call(withFcm, `${alice.base}/push/subscribe`, { fcmToken: TOKEN, welcome: true })).status).toBe(200);
    expect(await subscriptions()).toEqual([{ endpoint: `fcm:${TOKEN}`, member_id: alice.id, p256dh: "" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://fcm.googleapis.com/v1/projects/badminton-test/messages:send");
    expect(sent[0]!.auth).toBe("Bearer access-1");
    expect(sent[0]!.message.token).toBe(TOKEN);
    expect(sent[0]!.message.notification.title).toBe("推送已开启");
    expect(sent[0]!.message.data).toEqual({ url: "/", tag: "welcome" });
  });

  it("signs in to Google once for many pushes, and tells of a new event", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await call(withFcm, `${alice.base}/push/subscribe`, { fcmToken: TOKEN, welcome: true });
    const { status, data } = await call(
      withFcm,
      `${ctx.base}/events`,
      {
        date: futureDate(7),
        startTime: "19:00",
        endTime: "21:00",
        location: "Bay Badminton Center",
        deadlineDays: 1,
        deadlineHours: 0,
      },
      ctx.admin.cookie,
    );
    expect(status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.message.data.url).toBe(`/e/${data.code ?? data.event?.code}`);
    expect(sent[1]!.message.android.collapse_key).toBe(sent[1]!.message.data.tag);
    expect(signIns).toBe(1);
  });

  it("forgets an app that was removed, and lets the app turn push off", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await call(withFcm, `${alice.base}/push/subscribe`, { fcmToken: TOKEN });
    const off = await call(withFcm, `${alice.base}/push/unsubscribe`, { fcmToken: TOKEN });
    expect(off.data.removed).toBe(true);
    expect(await subscriptions()).toEqual([]);

    answer = () =>
      Response.json({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 });
    await call(withFcm, `${alice.base}/push/subscribe`, { fcmToken: TOKEN, welcome: true });
    expect(sent).toHaveLength(1);
    expect(await subscriptions()).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_outbox").first<{ n: number }>())!.n).toBe(0);
  });
});
