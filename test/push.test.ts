import {
  createExecutionContext,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "../src/worker/events";
import { pushBills, drainPushes } from "../src/worker/push";
import worker from "../src/worker/index";
import { ORIGIN, approveMember, billingScenario, futureDate, setUpAdmin } from "./helpers";

// ---- A browser on the other end: its keys, and RFC 8291 decryption of what it is sent ----

const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const cat = (...p: Uint8Array[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of p) {
    out.set(x, at);
    at += x.length;
  }
  return out;
};
const utf8 = (s: string) => new TextEncoder().encode(s);

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, n * 8));
}

interface Browser {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  priv: CryptoKey;
}

async function browser(name: string): Promise<Browser> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: { p256dh: b64(pub), auth: b64(crypto.getRandomValues(new Uint8Array(16))) },
    priv: pair.privateKey,
  };
}

async function decrypt(b: Browser, body: Uint8Array) {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const as = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: as } as any, b.priv, 256));
  const ikm = await hkdf(unb64(b.keys.auth), shared, cat(utf8("WebPush: info\0"), unb64(b.keys.p256dh), asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body.slice(21 + idlen)),
  );
  expect(plain[plain.length - 1]).toBe(2);
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

/** Checks the VAPID header the way a push service does. */
async function checkVapid(header: string, endpoint: string) {
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
  expect(m).toBeTruthy();
  const [head, claims, sig] = m[1]!.split(".");
  const key = await crypto.subtle.importKey("raw", unb64(m[2]!), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "verify",
  ]);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    unb64(sig!),
    utf8(`${head}.${claims}`),
  );
  expect(ok).toBe(true);
  const c = JSON.parse(new TextDecoder().decode(unb64(claims!)));
  expect(c.aud).toBe(new URL(endpoint).origin);
  expect(c.exp).toBeGreaterThan(Date.now() / 1000);
}

// ---- The push service ----

let pushes: { endpoint: string; auth: string; body: Uint8Array }[] = [];
let status = 201;

beforeEach(() => {
  pushes = [];
  status = 201;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.telegram.org/"))
      return Response.json({ ok: true, result: { username: "jb_test_bot", message_id: 1 } });
    if (!url.startsWith("https://fcm.googleapis.com/")) throw new Error(`unexpected fetch ${url}`);
    const h = new Headers(init?.headers);
    expect(h.get("Content-Encoding")).toBe("aes128gcm");
    pushes.push({ endpoint: url, auth: h.get("Authorization")!, body: new Uint8Array(init!.body as Uint8Array) });
    return new Response("", { status });
  });
});
afterEach(() => vi.restoreAllMocks());

async function received(b: Browser) {
  const mine = pushes.filter((p) => p.endpoint === b.endpoint);
  for (const p of mine) await checkVapid(p.auth, p.endpoint);
  return Promise.all(mine.map((p) => decrypt(b, p.body)));
}

/** A request whose after-the-response work (the pushes) has finished by the time it returns. */
async function call(path: string, body?: unknown, cookie = "") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, data: (await res.json()) as any };
}

const subscribe = (base: string, b: Browser, welcome = false) =>
  call(`${base}/push/subscribe`, { endpoint: b.endpoint, keys: b.keys, welcome });

async function createEvent(ctx: { admin: { cookie: string }; base: string }, extra: Record<string, unknown> = {}) {
  const body = { date: futureDate(7), startTime: "19:00", endTime: "21:00", location: "Bay Badminton Center" };
  const { status, data } = await call(
    `${ctx.base}/events`,
    { ...body, deadlineDays: 1, deadlineHours: 0, ...extra },
    ctx.admin.cookie,
  );
  expect(status).toBe(200);
  return data;
}

const subscriptions = async () =>
  (await env.DB.prepare("SELECT endpoint, member_id FROM push_subscriptions ORDER BY endpoint").all()).results;

describe("turning push on", () => {
  it("hands out one public key and sends a first push the browser can decrypt", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const k1 = (await call(`${alice.base}/push`)).data.publicKey;
    const k2 = (await call(`${alice.base}/push`)).data.publicKey;
    expect(k1).toBe(k2);
    expect(unb64(k1)).toHaveLength(65);
    const phone = await browser("alice-phone");
    expect((await subscribe(alice.base, phone, true)).status).toBe(200);
    const [msg] = await received(phone);
    expect(msg.title).toBe("推送已开启");
    expect(await subscriptions()).toEqual([{ endpoint: phone.endpoint, member_id: alice.id }]);
    // The page re-syncing on every visit sends nothing more.
    await subscribe(alice.base, phone);
    expect(pushes).toHaveLength(1);
  });

  it("refuses push services it doesn't know and malformed keys", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const b = await browser("x");
    const evil = await call(`${alice.base}/push/subscribe`, {
      endpoint: "https://169.254.169.254/latest",
      keys: b.keys,
    });
    expect(evil.status).toBe(400);
    const bad = await call(`${alice.base}/push/subscribe`, {
      endpoint: b.endpoint,
      keys: { p256dh: "abc", auth: b.keys.auth },
    });
    expect(bad.status).toBe(400);
    expect(await subscriptions()).toEqual([]);
  });

  it("moves a shared browser to whoever turned it on last", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const b = await browser("b");
    await subscribe(alice.base, b);
    // A push still waiting for Alice isn't sent once the browser is Bob's.
    status = 500;
    await createEvent(ctx);
    status = 201;
    await subscribe(bob.base, b);
    expect(await subscriptions()).toEqual([{ endpoint: b.endpoint, member_id: bob.id }]);
    pushes = [];
    await env.DB.prepare("UPDATE push_outbox SET claimed_at = NULL").run();
    await drainPushes(env);
    expect(pushes).toEqual([]);
    // Alice turning it off from her page doesn't touch Bob's.
    expect((await call(`${alice.base}/push/unsubscribe`, { endpoint: b.endpoint })).data.removed).toBe(false);
    expect(await subscriptions()).toHaveLength(1);
  });

  it("turns off for that browser only", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const [phone, laptop] = [await browser("p"), await browser("l")];
    await subscribe(alice.base, phone);
    await subscribe(alice.base, laptop);
    await call(`${alice.base}/push/unsubscribe`, { endpoint: phone.endpoint });
    expect((await subscriptions()).map((s) => s.endpoint)).toEqual([laptop.endpoint]);
  });

  it("forgets a member's browsers when their link is replaced or they are deleted", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    await subscribe(alice.base, await browser("a"));
    await subscribe(bob.base, await browser("b"));
    const { issueMemberToken } = await import("../src/worker/members");
    await issueMemberToken(env, alice.id);
    expect((await subscriptions()).map((s) => s.member_id)).toEqual([bob.id]);
    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(bob.id).run();
    expect((await ctx.admin.call(`${ctx.base}/members/${bob.id}/delete`, {})).status).toBe(200);
    expect(await subscriptions()).toEqual([]);
  });

  it("stops the Owner's pushes when their Google account is unbound", async () => {
    const ctx = await setUpAdmin();
    await env.DB.prepare(
      "INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) SELECT 'https://fcm.googleapis.com/fcm/send/o', id, 'k', 'a', '2026-01-01' FROM members WHERE is_owner = 1",
    ).run();
    expect((await call(`${ctx.base}/settings/google/unbind`, {}, ctx.admin.cookie)).status).toBe(200);
    expect(await subscriptions()).toEqual([]);
  });
});

describe("what gets pushed", () => {
  it("a new event, to every active member except whoever created it", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const owner = await browser("owner");
    const [a, b] = [await browser("alice"), await browser("bob")];
    await env.DB.prepare(
      "INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) SELECT ?, id, ?, ?, '2026-01-01' FROM members WHERE is_owner = 1",
    )
      .bind(owner.endpoint, owner.keys.p256dh, owner.keys.auth)
      .run();
    await subscribe(alice.base, a);
    await subscribe(bob.base, b);
    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(bob.id).run();
    const e = await createEvent(ctx, { title: "周三局" });
    const [msg] = await received(a);
    expect(msg.title).toBe("Jay 发起了新活动");
    expect(msg.body).toContain("周三局");
    expect(msg.body).toContain("Bay Badminton Center");
    expect(msg.url).toBe(`/e/${e.code}`);
    expect(await received(owner)).toEqual([]);
    expect(await received(b)).toEqual([]);
  });

  it("each owing member's own bill when the event is finalized, once", async () => {
    const s = await billingScenario();
    const [a, b] = [await browser("alice"), await browser("bob")];
    await subscribe(s.alice.base, a);
    await subscribe(s.bob.base, b);
    await call(`${s.eb}/finalize`, s.fees, s.admin.cookie);
    const due = async (id: string) =>
      (
        await env.DB.prepare("SELECT amount_due_cents AS c FROM payments WHERE event_id = ? AND member_id = ?")
          .bind(s.e.id, id)
          .first<{ c: number }>()
      )?.c;
    const [billA] = await received(a);
    expect(billA.title).toBe("账单出来了");
    expect(billA.body).toContain(`你需要付 $${((await due(s.alice.id))! / 100).toFixed(2)}，付给 Jay`);
    const [billB] = await received(b);
    expect(billB.body).toContain(`你需要付 $${((await due(s.bob.id))! / 100).toFixed(2)}，付给 Jay`);
    pushes = [];
    await call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "150" }, s.admin.cookie);
    expect(pushes).toEqual([]);
    // Only those who still owe: Bob paid in the meantime.
    await env.DB.prepare(
      "UPDATE payments SET amount_paid_cents = amount_due_cents, status = 'paid' WHERE member_id = ?",
    )
      .bind(s.bob.id)
      .run();
    await pushBills(env, (await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(s.e.id).first<EventRow>())!);
    await drainPushes(env);
    expect(pushes.map((p) => p.endpoint)).toEqual([a.endpoint]);
  });

  it("drops gone browsers, retries the rest later and gives up after three tries", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const a = await browser("alice");
    await subscribe(alice.base, a);
    status = 500;
    await createEvent(ctx);
    expect(pushes).toHaveLength(1);
    // Claimed just now: the cron doesn't send it again until the claim is old.
    await drainPushes(env);
    expect(pushes).toHaveLength(1);
    await env.DB.prepare("UPDATE push_outbox SET claimed_at = '2000-01-01T00:00:00.000Z'").run();
    await drainPushes(env);
    expect(pushes).toHaveLength(2);
    await env.DB.prepare("UPDATE push_outbox SET claimed_at = '2000-01-01T00:00:00.000Z'").run();
    await drainPushes(env);
    await env.DB.prepare("UPDATE push_outbox SET claimed_at = '2000-01-01T00:00:00.000Z'").run();
    await drainPushes(env);
    expect(pushes).toHaveLength(3);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_outbox").first())?.n).toBe(0);

    status = 410;
    await createEvent(ctx);
    expect(pushes).toHaveLength(4);
    expect(await subscriptions()).toEqual([]);

    // Turned away (403: our signature): not retried, still subscribed.
    await subscribe(alice.base, a);
    status = 403;
    await createEvent(ctx);
    expect(pushes).toHaveLength(5);
    await env.DB.prepare("UPDATE push_outbox SET claimed_at = '2000-01-01T00:00:00.000Z'").run();
    await drainPushes(env);
    expect(pushes).toHaveLength(5);
    expect(await subscriptions()).toHaveLength(1);
  });

  it("doesn't send what is no longer true: a cancelled event, a paid bill", async () => {
    const s = await billingScenario();
    const a = await browser("alice");
    await subscribe(s.alice.base, a);
    status = 500;
    const e = await createEvent(s);
    await call(`${s.eb}/finalize`, s.fees, s.admin.cookie);
    expect(pushes).toHaveLength(2);
    status = 201;
    await call(`${s.base}/events/${e.id}/cancel`, {}, s.admin.cookie);
    await env.DB.prepare(
      "UPDATE payments SET amount_paid_cents = amount_due_cents, status = 'paid' WHERE member_id = ?",
    )
      .bind(s.alice.id)
      .run();
    await env.DB.prepare("UPDATE push_outbox SET claimed_at = '2000-01-01T00:00:00.000Z'").run();
    pushes = [];
    await drainPushes(env);
    expect(pushes).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_outbox").first())?.n).toBe(0);
  });

  it("sends a backlog 20 at a time, a second apart, until it is all out", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const a = await browser("alice");
    // More browsers than one run sends (the 10 per member limit is only on turning push on).
    const add = env.DB.prepare(
      "INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, '2026-01-01')",
    );
    await env.DB.batch(
      Array.from({ length: 45 }, (_, i) => add.bind(`${a.endpoint}-${i}`, alice.id, a.keys.p256dh, a.keys.auth)),
    );
    const sender = env.PUSH.get(env.PUSH.idFromName("push"));
    const alarm = () => runInDurableObject(sender, (_o, state) => state.storage.getAlarm());
    // Moved out of the way once checked, so it can't also go off by itself while the test runs.
    const park = () => runInDurableObject(sender, (_o, state) => state.storage.setAlarm(Date.now() + 3600_000));
    const before = Date.now();
    await createEvent(ctx);
    const at = await alarm();
    await park();
    expect(pushes).toHaveLength(20);
    expect(at).toBeGreaterThanOrEqual(before + 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
    await runDurableObjectAlarm(sender);
    const next = await alarm();
    await park();
    expect(pushes).toHaveLength(40);
    expect(next).not.toBeNull();
    await runDurableObjectAlarm(sender);
    expect(pushes).toHaveLength(45);
    expect(new Set(pushes.map((p) => p.endpoint)).size).toBe(45);
    expect(await alarm()).toBeNull();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM push_outbox").first())?.n).toBe(0);
  });

  it("leaves failed pushes to the cron instead of trying again every second", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await subscribe(alice.base, await browser("alice"));
    status = 500;
    await createEvent(ctx);
    expect(pushes).toHaveLength(1);
    expect(
      await runInDurableObject(env.PUSH.get(env.PUSH.idFromName("push")), (_o, state) => state.storage.getAlarm()),
    ).toBeNull();
  });

  it("never fails the request when the push service is down", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    await subscribe(alice.base, await browser("alice"));
    vi.mocked(fetch).mockImplementation(async () => {
      throw new Error("network down");
    });
    await createEvent(ctx);
  });
});
