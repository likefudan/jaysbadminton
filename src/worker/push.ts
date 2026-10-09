import type { Context } from "hono";
import { dollars } from "../shared/settle";
import { formatDateZh, toPacific } from "../shared/time";
import { getSettings, now } from "./db";
import type { Env } from "./env";
import type { EventRow } from "./events";
import { badRequest } from "./http";
import { fromBase64Url as fromB64url, toBase64Url as b64url } from "./lib/crypto";
import { eventManager, eventPayee } from "./organizers";
import { day, venue, when } from "./eventText";
import { payeeName } from "./payees";

/**
 * 推送通知 to members' browsers (Web Push, RFC 8030/8291/8292). Members turn it on from their own
 * page; two things are pushed: a new event open for sign-up, and their bill once an event is
 * finalized. The request queues them in push_outbox and sends them after its response
 * (sendSoon), so they never slow it down, fail it or use up what it needs for its own notices; the
 * cron sends anything left over and retries what failed.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Opened on tap (the service worker prefers the member's own page for link members). */
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag: string;
}

/** Push services browsers use. Anything else is refused, so the Worker never posts to other hosts. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
];
const MAX_PER_MEMBER = 10;
/**
 * Pushes per batch; a request (after its work) and a cron run each send up to two. Kept small for
 * the free plan: each push costs some CPU (a key pair and the encryption) and a subrequest, and an
 * invocation gets 10 ms of CPU and 50 subrequests. The rest wait for the next cron run.
 */
const BATCH = 10;
export const BATCHES = 2;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 5 * 60_000;
const EXPIRE_MS = 24 * 3600_000;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

// ---- VAPID keys: made on first use and kept in settings, so every subscription stays valid ----

interface VapidKeys {
  publicKey: string;
  privateJwk: JsonWebKey;
}

export async function vapidKeys(env: Env): Promise<VapidKeys> {
  const { vapid_keys: saved } = await getSettings(env.DB, ["vapid_keys"]);
  if (saved) return JSON.parse(saved) as VapidKeys;
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const keys: VapidKeys = {
    publicKey: b64url(raw),
    privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
  };
  // Two first requests at once: whichever lands first wins and both use it.
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_keys', ?)")
    .bind(JSON.stringify(keys))
    .run();
  return vapidKeys(env);
}

/** The Authorization header for one push service (RFC 8292), by its origin. */
async function vapidAuth(env: Env, keys: VapidKeys, aud: string): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const head = b64url(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    text(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.SITE_ORIGIN,
      }),
    ),
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text(`${head}.${claims}`)),
  );
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

// ---- Payload encryption (RFC 8291, aes128gcm) ----

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

export async function encryptPayload(payload: string, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublic = fromB64url(p256dh);
  const ua = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: ua } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      local.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(fromB64url(auth), shared, concat(text("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record: the payload and the 0x02 delimiter that marks it as the last.
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(text(payload), new Uint8Array([2]))),
  );
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

// ---- Subscriptions ----

/** Checks what a browser's PushSubscription.toJSON() sent and stores it for this member. */
export async function subscribe(env: Env, memberId: string, body: Record<string, unknown>): Promise<string> {
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const keys = (body.keys ?? {}) as Record<string, unknown>;
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw badRequest("这个浏览器的推送信息不对，请重试");
  }
  if (url.protocol !== "https:" || endpoint.length > 1000 || !PUSH_HOSTS.some((h) => h.test(url.hostname)))
    throw badRequest("不支持这个浏览器的推送服务");
  let ok = false;
  try {
    ok = fromB64url(p256dh).length === 65 && fromB64url(auth).length === 16;
  } catch {}
  if (!ok) throw badRequest("这个浏览器的推送信息不对，请重试");
  await env.DB.batch([
    // The same browser moving to another member (a shared computer) is taken over by the new one.
    env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh,
         auth = excluded.auth, created_at = excluded.created_at`,
    ).bind(endpoint, memberId, p256dh, auth, now()),
    // Browsers that were reset or reinstalled leave old ones behind; keep only the newest few.
    env.DB.prepare(
      `DELETE FROM push_subscriptions WHERE member_id = ?1 AND endpoint NOT IN
         (SELECT endpoint FROM push_subscriptions WHERE member_id = ?1 ORDER BY created_at DESC LIMIT ?2)`,
    ).bind(memberId, MAX_PER_MEMBER),
  ]);
  return endpoint;
}

/** Whether it was this member's (a browser shared with someone else's page keeps theirs). */
export async function unsubscribe(env: Env, memberId: string, endpoint: string): Promise<boolean> {
  const res = await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND member_id = ?")
    .bind(endpoint, memberId)
    .run();
  return res.meta.changes > 0;
}

// ---- Queue and send ----

/**
 * Sends what was just queued in the background, so the response doesn't wait for it. Call it last
 * in the handler: it starts at once. `endpoint` sends only that browser's (the 推送已开启 one),
 * ahead of any backlog. The cron picks up whatever this misses.
 */
export function sendSoon<E extends { Bindings: Env }>(c: Context<E>, endpoint?: string): void {
  const work = (async () => {
    for (let batch = 0; batch < BATCHES; batch++) if (!(await sendPushes(c.env, endpoint))) return;
  })().catch((err) => console.error("push failed:", err));
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (a direct call in tests): the promise still runs.
  }
}

/** A push to one browser only (the one that just turned push on), so the member sees it works. */
export async function pushWelcome(env: Env, memberId: string, endpoint: string, home: string): Promise<void> {
  await env.DB.prepare("INSERT INTO push_outbox (endpoint, member_id, payload, created_at) VALUES (?, ?, ?, ?)")
    .bind(
      endpoint,
      memberId,
      JSON.stringify({
        title: "推送已开启",
        body: "有新活动开始报名、或者你的账单出来时，会在这里通知你。",
        url: home,
        tag: "welcome",
      } satisfies PushMessage),
      now(),
    )
    .run();
}

/** `later`: this run is out of subrequests (the Worker refused the fetch); not counted as a try. */
// (Rows a run claimed but never finished free up after RETRY_AFTER_MS, also without counting.)
type Outcome = "sent" | "gone" | "drop" | "retry" | "later";

async function deliver(
  authFor: (endpoint: string) => Promise<string>,
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
): Promise<Outcome> {
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await authFor(sub.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(EXPIRE_MS / 1000),
        Urgency: "normal",
      },
      body: await encryptPayload(payload, sub.p256dh, sub.auth),
    });
    if (res.ok) {
      // Frees the connection for the rest of the batch.
      await res.body?.cancel();
      return "sent";
    }
    // The browser turned push off or the subscription expired.
    if (res.status === 404 || res.status === 410) return "gone";
    console.warn(`push to ${new URL(sub.endpoint).host} failed: ${res.status} ${await res.text().catch(() => "")}`);
    // Rejected (bad payload, or our signature: Apple says 403 for that): this one won't get through,
    // but the browser stays subscribed.
    if (res.status === 400 || res.status === 403 || res.status === 413) return "drop";
    return "retry";
  } catch (err) {
    if (String(err).includes("Too many subrequests")) return "later";
    console.warn("push failed:", err);
    return "retry";
  }
}

/**
 * Sends up to one batch from push_outbox. Rows are claimed first, so the cron and a request
 * running at the same time never send the same one; a claim left by a run that died frees up
 * after a few minutes. Pushes older than a day are dropped (the browser would drop them anyway).
 */
/** Whether there may be more to send right now (a full batch went out). */
export async function sendPushes(env: Env, endpoint?: string): Promise<boolean> {
  const at = Date.now();
  await env.DB.prepare("DELETE FROM push_outbox WHERE created_at < ? OR attempts >= ?")
    .bind(new Date(at - EXPIRE_MS).toISOString(), MAX_ATTEMPTS)
    .run();
  const { results } = await env.DB.prepare(
    `UPDATE push_outbox SET claimed_at = ?1
     WHERE id IN (SELECT id FROM push_outbox WHERE (claimed_at IS NULL OR claimed_at < ?2)
       AND (?4 IS NULL OR endpoint = ?4) ORDER BY id LIMIT ?3)
     RETURNING id`,
  )
    .bind(new Date(at).toISOString(), new Date(at - RETRY_AFTER_MS).toISOString(), BATCH, endpoint ?? null)
    .all<{ id: number }>();
  if (results.length === 0) return false;
  const { results: rows } = await env.DB.prepare(
    `SELECT o.id, o.payload, s.endpoint, s.p256dh, s.auth FROM push_outbox o
     LEFT JOIN push_subscriptions s ON s.endpoint = o.endpoint AND s.member_id = o.member_id WHERE o.id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(results.map((r) => r.id)))
    .all<{ id: number; payload: string; endpoint: string | null; p256dh: string; auth: string }>();
  const keys = await vapidKeys(env);
  // One signature per push service per run (CPU is tight on the free plan).
  const signed = new Map<string, Promise<string>>();
  const authFor = (endpoint: string) => {
    const aud = new URL(endpoint).origin;
    if (!signed.has(aud)) signed.set(aud, vapidAuth(env, keys, aud));
    return signed.get(aud)!;
  };
  const outcomes = await Promise.all(
    rows.map(async (r) => ({
      r,
      // Turned off (or moved to another member) since it was queued: nothing to send.
      outcome: r.endpoint ? await deliver(authFor, { ...r, endpoint: r.endpoint }, r.payload) : ("drop" as Outcome),
    })),
  );
  const ids = (...kinds: Outcome[]) =>
    JSON.stringify(outcomes.filter((o) => kinds.includes(o.outcome)).map((o) => o.r.id));
  const gone = outcomes.filter((o) => o.outcome === "gone").map((o) => o.r.endpoint!);
  await env.DB.batch([
    env.DB.prepare("UPDATE push_outbox SET claimed_at = NULL WHERE id IN (SELECT value FROM json_each(?))").bind(
      ids("later"),
    ),
    // Counted here, not when claimed, so a run that died before sending (CPU limit) costs no try.
    env.DB.prepare("UPDATE push_outbox SET attempts = attempts + 1 WHERE id IN (SELECT value FROM json_each(?))").bind(
      ids("retry"),
    ),
    env.DB.prepare("DELETE FROM push_outbox WHERE id IN (SELECT value FROM json_each(?))").bind(
      ids("sent", "gone", "drop"),
    ),
    env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint IN (SELECT value FROM json_each(?))").bind(
      JSON.stringify(gone),
    ),
  ]);
  // Out of subrequests: more would only fail the same way.
  return results.length === BATCH && !outcomes.some((o) => o.outcome === "later");
}

// ---- What gets pushed ----

/**
 * 新活动: every active member except whoever created it (and whoever runs it, should it have been
 * handed to the Owner as it was made). Whether anything was queued.
 */
export async function pushNewEvent(env: Env, e: EventRow, creatorId: string | null): Promise<boolean> {
  try {
    const manager = await eventManager(env.DB, e);
    const deadline = toPacific(e.deadline_at);
    const msg: PushMessage = {
      title: `${await payeeName(env.DB, manager)} 发起了新活动`,
      body: `${when(e)}\n${venue(e)}\n报名截止：${formatDateZh(deadline.date)} ${deadline.time}`,
      url: `/e/${e.code}`,
      tag: `event-${e.id}`,
    };
    const res = await env.DB.prepare(
      `INSERT INTO push_outbox (endpoint, member_id, payload, created_at)
       SELECT s.endpoint, s.member_id, ?1, ?2 FROM push_subscriptions s JOIN members m ON m.id = s.member_id
       WHERE m.status = 'active' AND m.deleted_at IS NULL AND m.id IS NOT ?3 AND m.id IS NOT ?4`,
    )
      .bind(JSON.stringify(msg), now(), creatorId, manager)
      .run();
    return res.meta.changes > 0;
  } catch (err) {
    console.error("push failed:", err);
    return false;
  }
}

/** 账单: each member who still owes on the event (call it on the first Finalize only). */
export async function pushBills(env: Env, e: EventRow): Promise<boolean> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT p.member_id, p.amount_due_cents - p.amount_paid_cents AS owed FROM payments p
       JOIN members m ON m.id = p.member_id
       WHERE p.event_id = ? AND p.amount_due_cents > p.amount_paid_cents AND m.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.member_id = p.member_id)`,
    )
      .bind(e.id)
      .all<{ member_id: string; owed: number }>();
    if (results.length === 0) return false;
    const payee = await payeeName(env.DB, await eventPayee(env.DB, e));
    // One message each (their own amount), to each of their browsers.
    await env.DB.batch(
      results.map((r) =>
        env.DB.prepare(
          "INSERT INTO push_outbox (endpoint, member_id, payload, created_at) SELECT endpoint, member_id, ?, ? FROM push_subscriptions WHERE member_id = ?",
        ).bind(
          JSON.stringify({
            title: "账单出来了",
            body: `${day(e)} 羽毛球：你需要付 $${dollars(r.owed)}，付给 ${payee}。点开查看明细和付款方式。`,
            url: `/e/${e.code}`,
            tag: `bill-${e.id}`,
          } satisfies PushMessage),
          now(),
          r.member_id,
        ),
      ),
    );
    return true;
  } catch (err) {
    console.error("push failed:", err);
    return false;
  }
}
