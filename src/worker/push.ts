import { DurableObject } from "cloudflare:workers";
import type { Context } from "hono";
import { dollars } from "../shared/settle";
import { formatDateZh, toPacific } from "../shared/time";
import { getSettings, now } from "./db";
import type { Env } from "./env";
import { type EventRow, bookedCourts } from "./events";
import { badRequest } from "./http";
import { fromBase64Url as fromB64url, toBase64Url as b64url } from "./lib/crypto";
import { eventManager, eventPayee } from "./organizers";
import { day, venue, when } from "./eventText";
import { payeeName } from "./payees";

/**
 * 推送通知 to members' browsers (Web Push, RFC 8030/8291/8292). Members turn it on from their own
 * page; what is pushed: a new event open for sign-up, a reminder 10 minutes before an event
 * they're on starts (with its 预定场地), their bill once an event is finalized, and changes someone
 * else made to their sign-up (added or taken off the list, the event cancelled). The request queues them in push_outbox and sends them after its response
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
 * Pushes per batch; a request (after its work), a cron run and each PushSender alarm send up to two.
 * Kept small for the free plan: each push costs some CPU (about 0.3 ms for a key pair and the
 * encryption) and a subrequest, and an invocation gets 10 ms of CPU and 50 subrequests. The rest go
 * out NEXT_RUN_MS later from the PushSender alarm, each a run of its own.
 */
const BATCH = 10;
const BATCHES = 2;
const NEXT_RUN_MS = 1000;
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
 * ahead of any backlog. What doesn't fit goes to the PushSender alarm; the cron picks up whatever
 * both miss.
 */
export function sendSoon<E extends { Bindings: Env }>(c: Context<E>, endpoint?: string): void {
  const work = drainPushes(c.env, endpoint)
    .then((more) => (more ? sendRest(c.env) : undefined))
    .catch((err) => console.error("push failed:", err));
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context (a direct call in tests): the promise still runs.
  }
}

/**
 * Up to BATCHES batches: what one run (a request, the cron, an alarm) sends. Whether pushes are still
 * waiting that could go out now (not a failed one until its claim frees up after RETRY_AFTER_MS; the
 * next run after that, usually the cron, tries it again).
 */
export async function drainPushes(env: Env, endpoint?: string): Promise<boolean> {
  await env.DB.prepare("DELETE FROM push_outbox WHERE created_at < ? OR attempts >= ?")
    .bind(new Date(Date.now() - EXPIRE_MS).toISOString(), MAX_ATTEMPTS)
    .run();
  const keys = await vapidKeys(env);
  for (let batch = 0; batch < BATCHES; batch++) if (!(await sendBatch(env, keys, endpoint))) break;
  const waiting = await env.DB.prepare("SELECT 1 FROM push_outbox WHERE claimed_at IS NULL OR claimed_at < ? LIMIT 1")
    .bind(new Date(Date.now() - RETRY_AFTER_MS).toISOString())
    .first();
  return waiting !== null;
}

/**
 * Sends the rest of a backlog: one run every NEXT_RUN_MS, each with its own CPU and subrequests,
 * until nothing is left that can go out now. A single instance, so runs never overlap. A failed
 * alarm is retried by Cloudflare, and the cron sends anything left over either way.
 */
export class PushSender extends DurableObject<Env> {
  /** Another run in NEXT_RUN_MS, unless one is due sooner. */
  async soon(): Promise<void> {
    const at = Date.now() + NEXT_RUN_MS;
    const set = await this.ctx.storage.getAlarm();
    if (set === null || set > at) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    if (await drainPushes(this.env)) await this.soon();
  }
}

/** Hands what is left to the PushSender. Never throws: the cron sends it otherwise. */
export async function sendRest(env: Env): Promise<void> {
  try {
    await env.PUSH.get(env.PUSH.idFromName("push")).soon();
  } catch (err) {
    console.error("push sender failed:", err);
  }
}

/** A push to one browser only (the one that just turned push on), so the member sees it works. */
export async function pushWelcome(env: Env, memberId: string, endpoint: string, home: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO push_outbox (endpoint, member_id, kind, payload, created_at) VALUES (?, ?, 'welcome', ?, ?)",
  )
    .bind(
      endpoint,
      memberId,
      JSON.stringify({
        title: "推送已开启",
        body: "有新活动开始报名、别人帮你改了报名、或者你的账单出来时，会在这里通知你。",
        url: home,
        tag: "welcome",
      } satisfies PushMessage),
      now(),
    )
    .run();
}

/** `later`: this run is out of subrequests (the Worker refused the fetch); not counted as a try. */
// A try is counted when a row is claimed, so a run that keeps dying part way (CPU limit) gives up
// after MAX_ATTEMPTS instead of sending the same first pushes again and again.
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
    // Read or cancelled every time, so the connection is free for the rest of the batch.
    if (res.ok || res.status === 404 || res.status === 410) await res.body?.cancel();
    if (res.ok) return "sent";
    // The browser turned push off or the subscription expired.
    if (res.status === 404 || res.status === 410) return "gone";
    console.warn(`push to ${new URL(sub.endpoint).host} failed: ${res.status} ${await res.text().catch(() => "")}`);
    // Rejected (bad payload, or our signature): this one won't get through, but the browser stays
    // subscribed. (A subscription made for other keys can't happen: only a reset makes new keys,
    // and it clears the subscriptions too.)
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 413) return "drop";
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
async function sendBatch(env: Env, keys: VapidKeys, endpoint?: string): Promise<boolean> {
  const at = Date.now();
  const { results } = await env.DB.prepare(
    `UPDATE push_outbox SET claimed_at = ?1, attempts = attempts + 1
     WHERE id IN (SELECT id FROM push_outbox WHERE (claimed_at IS NULL OR claimed_at < ?2)
       AND (?4 IS NULL OR endpoint = ?4) ORDER BY id LIMIT ?3)
     RETURNING id`,
  )
    .bind(new Date(at).toISOString(), new Date(at - RETRY_AFTER_MS).toISOString(), BATCH, endpoint ?? null)
    .all<{ id: number }>();
  if (results.length === 0) return false;
  const { results: rows } = await env.DB.prepare(
    `SELECT o.id, o.payload, s.endpoint, s.p256dh, s.auth,
       CASE o.kind
         WHEN 'event' THEN NOT COALESCE((SELECT status = 'open' AND deadline_at > ?2 FROM events WHERE id = o.event_id), 0)
         WHEN 'settle' THEN NOT COALESCE((SELECT status = 'closed' FROM events WHERE id = o.event_id), 0)
         WHEN 'roster' THEN NOT COALESCE((SELECT status != 'cancelled' FROM events WHERE id = o.event_id), 0)
         WHEN 'start' THEN NOT COALESCE((SELECT status IN ('open', 'closed') AND start_at > ?2 FROM events WHERE id = o.event_id), 0)
           OR NOT EXISTS (SELECT 1 FROM registrations r WHERE r.event_id = o.event_id AND r.member_id = o.member_id)
         WHEN 'bill' THEN NOT EXISTS (SELECT 1 FROM payments p WHERE p.event_id = o.event_id
           AND p.member_id = o.member_id AND p.status != 'paid')
         ELSE 0 END AS stale
     FROM push_outbox o
     LEFT JOIN push_subscriptions s ON s.endpoint = o.endpoint AND s.member_id = o.member_id
     WHERE o.id IN (SELECT value FROM json_each(?1))`,
  )
    .bind(JSON.stringify(results.map((r) => r.id)), new Date(at).toISOString())
    .all<{ id: number; payload: string; endpoint: string | null; p256dh: string; auth: string; stale: number }>();
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
      // Turned off (or moved to another member) since it was queued, or no longer true (the event
      // was cancelled or closed, the bill paid, the event already started or they dropped out):
      // nothing to send.
      outcome:
        r.endpoint && !r.stale
          ? await deliver(authFor, { ...r, endpoint: r.endpoint }, r.payload)
          : ("drop" as Outcome),
    })),
  );
  const ids = (...kinds: Outcome[]) =>
    JSON.stringify(outcomes.filter((o) => kinds.includes(o.outcome)).map((o) => o.r.id));
  const gone = outcomes.filter((o) => o.outcome === "gone").map((o) => o.r.endpoint!);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE push_outbox SET claimed_at = NULL, attempts = attempts - 1 WHERE id IN (SELECT value FROM json_each(?))",
    ).bind(ids("later")),
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
    const msg: PushMessage = {
      title: `${await payeeName(env.DB, manager)} 发起了新活动`,
      body: `${when(e)}\n${venue(e)}${e.no_deadline ? "" : `\n报名截止：${formatDateZh(toPacific(e.deadline_at).date)} ${toPacific(e.deadline_at).time}`}`,
      url: `/e/${e.code}`,
      tag: `event-${e.id}`,
    };
    const res = await env.DB.prepare(
      `INSERT INTO push_outbox (endpoint, member_id, kind, event_id, payload, created_at)
       SELECT s.endpoint, s.member_id, 'event', ?5, ?1, ?2 FROM push_subscriptions s JOIN members m ON m.id = s.member_id
       WHERE m.status = 'active' AND m.deleted_at IS NULL AND m.id IS NOT ?3 AND m.id IS NOT ?4`,
    )
      .bind(JSON.stringify(msg), now(), creatorId, manager, e.id)
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
          `INSERT INTO push_outbox (endpoint, member_id, kind, event_id, payload, created_at)
           SELECT endpoint, member_id, 'bill', ?, ?, ? FROM push_subscriptions WHERE member_id = ?`,
        ).bind(
          e.id,
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

/** Queues one message to each of a member's browsers. Whether there were any. */
async function pushTo(env: Env, memberId: string, kind: string, e: EventRow, msg: PushMessage): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO push_outbox (endpoint, member_id, kind, event_id, payload, created_at)
     SELECT s.endpoint, s.member_id, ?, ?, ?, ? FROM push_subscriptions s JOIN members m ON m.id = s.member_id
     WHERE s.member_id = ? AND m.deleted_at IS NULL`,
  )
    .bind(kind, e.id, JSON.stringify(msg), now(), memberId)
    .run();
  return res.meta.changes > 0;
}

/** What someone else did to a member's rows on an event's list. */
export interface RosterChange {
  added: boolean;
  /** The member themselves was added or taken off (not only friends). */
  self: boolean;
  /** Friends added or taken off, as the list names them. */
  friends: string[];
  /** Rows the member still has on the list afterwards. */
  left: number;
}

/**
 * 名单变动: the Owner, an admin or the organizer added a member (or friends under them) to an event
 * or took them off it. Never when the member did it themselves. Whether anything was queued.
 */
export async function pushRosterChange(
  env: Env,
  e: EventRow,
  memberId: string,
  actor: string | null,
  change: RosterChange,
): Promise<boolean> {
  if (memberId === actor) return false;
  try {
    const by = await payeeName(env.DB, actor);
    const friends = change.friends.join("、");
    const title = change.added
      ? change.self
        ? `${by} 帮你报了名`
        : `${by} 帮你的朋友报了名`
      : change.self
        ? `${by} 把你移出了名单`
        : `${by} 把你的朋友移出了名单`;
    let body = change.added
      ? change.self
        ? friends
          ? `${when(e)}：你和朋友 ${friends} 都在名单上了。`
          : `${when(e)}：你在名单上了。`
        : `${when(e)}：你的朋友 ${friends} 在名单上了。`
      : change.self
        ? `${when(e)}：你不在名单上了。${change.left ? `你带的 ${change.left} 个朋友还在名单上。` : ""}`
        : `${when(e)}：你的朋友 ${friends} 不在名单上了。`;
    if (e.status === "finalized") body += "账单已重新计算，点开查看。";
    return await pushTo(env, memberId, "roster", e, { title, body, url: `/e/${e.code}`, tag: `roster-${e.id}` });
  } catch (err) {
    console.error("push failed:", err);
    return false;
  }
}

/**
 * 带群友: a member was brought to an event by someone paying for them, or taken off it again (by
 * whoever brought them, or from the admin page). `actor` did it; never pushed to themselves.
 */
export async function pushBrought(
  env: Env,
  e: EventRow,
  guest: string,
  bringer: string,
  actor: string | null,
  added: boolean,
): Promise<boolean> {
  if (guest === actor) return false;
  try {
    const [by, payer] = await Promise.all([payeeName(env.DB, actor), payeeName(env.DB, bringer)]);
    const title =
      actor === bringer
        ? added
          ? `${by} 带你报名了`
          : `${by} 取消了带你报名`
        : added
          ? `${by} 帮你报了名`
          : `${by} 把你移出了名单`;
    const body = added ? `${when(e)}：你在名单上了，费用由 ${payer} 付。` : `${when(e)}：你不在名单上了。`;
    return await pushTo(env, guest, "roster", e, { title, body, url: `/e/${e.code}`, tag: `roster-${e.id}` });
  } catch (err) {
    console.error("push failed:", err);
    return false;
  }
}

/** 带群友: the member someone brought said they're not coming (我不去了); tells whoever brought them. */
export async function pushGuestLeft(env: Env, e: EventRow, bringer: string, guest: string): Promise<boolean> {
  try {
    const name = await payeeName(env.DB, guest);
    return await pushTo(env, bringer, "roster", e, {
      title: `${name} 不去了`,
      body: `${when(e)}：${name} 不在名单上了，不用再替 ${name} 付。`,
      url: `/e/${e.code}`,
      tag: `roster-${e.id}`,
    });
  } catch (err) {
    console.error("push failed:", err);
    return false;
  }
}

/** 活动取消: everyone on the list (themselves or friends), except whoever cancelled it. */
export async function pushCancelled(env: Env, e: EventRow, actor: string | null): Promise<boolean> {
  try {
    const msg: PushMessage = {
      title: `${await payeeName(env.DB, actor)} 取消了活动`,
      body: `${when(e)}\n${venue(e)}\n活动取消了，你的报名也一并取消。`,
      url: `/e/${e.code}`,
      // Replaces the 新活动 one if it is still showing.
      tag: `event-${e.id}`,
    };
    const res = await env.DB.prepare(
      `INSERT INTO push_outbox (endpoint, member_id, kind, event_id, payload, created_at)
       SELECT s.endpoint, s.member_id, 'cancel', ?1, ?2, ?3 FROM push_subscriptions s JOIN members m ON m.id = s.member_id
       WHERE m.deleted_at IS NULL AND m.id IS NOT ?4
         AND m.id IN (SELECT member_id FROM registrations WHERE event_id = ?1)`,
    )
      .bind(e.id, JSON.stringify(msg), now(), actor)
      .run();
    return res.meta.changes > 0;
  } catch (err) {
    console.error("push failed:", err);
    return false;
  }
}

/** How long before the start 快开始了 goes out. */
export const START_PUSH_MS = 10 * 60_000;

/**
 * 快开始了: everyone on the event (friends' hosts too) 10 minutes before the start, with the courts
 * booked for it when set. Whether anything was queued; called once per start time (notify.ts).
 */
export async function pushStarting(env: Env, e: EventRow): Promise<boolean> {
  const courts = bookedCourts(e);
  const msg: PushMessage = {
    title: "羽毛球 10 分钟后开始",
    body: [
      `${toPacific(e.start_at).time}–${toPacific(e.end_at).time} ${e.title || e.location}`,
      ...(e.title ? [e.location] : []),
      courts.length ? `场地：${courts.join("、")} 号` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    url: `/e/${e.code}`,
    tag: `start-${e.id}`,
  };
  const res = await env.DB.prepare(
    `INSERT INTO push_outbox (endpoint, member_id, kind, event_id, payload, created_at)
     SELECT s.endpoint, s.member_id, 'start', ?1, ?2, ?3 FROM push_subscriptions s JOIN members m ON m.id = s.member_id
     WHERE m.status = 'active' AND m.deleted_at IS NULL
       AND m.id IN (SELECT member_id FROM registrations WHERE event_id = ?1)`,
  )
    .bind(e.id, JSON.stringify(msg), now())
    .run();
  return res.meta.changes > 0;
}

/**
 * 结算提醒 on the phone of the organizer or admin who runs the event (the Owner's come on
 * Telegram): every half hour until it's finalized (notify.ts). Stale once it's no longer closed.
 */
export async function pushSettle(env: Env, e: EventRow, headcount: number, warn: boolean): Promise<boolean> {
  if (!e.manager_id) return false;
  return pushTo(env, e.manager_id, "settle", e, {
    title: "请结算羽毛球活动",
    body: [
      `${day(e)}${e.title ? "" : ` ${e.location}`} 已结束（报名 ${headcount} 人）`,
      "请填写场地费和用球数，然后点 Finalize。",
      warn ? "还剩不到 2 小时，过时会自动归档，不收费。" : "",
    ]
      .filter(Boolean)
      .join("\n"),
    url: "/admin/google",
    tag: `settle-${e.id}`,
  });
}
