import { env, exports } from "cloudflare:workers";
import worker from "../src/worker/index";
import { sha256 } from "../src/worker/lib/crypto";
import { createMember } from "../src/worker/members";

export const ORIGIN = "https://jaysbadminton.test";

/** A tiny client that keeps the admin session cookie between calls, like a browser would. */
export class Client {
  cookie = "";

  async call<T = any>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await exports.default.fetch(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("Set-Cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0]!;
    return { status: res.status, data: (await res.json()) as T };
  }
}

export const tokenOf = (link: string) => link.split("/").pop()!;

/** Runs first-time setup and returns a logged-in admin client plus the links it produced. */
export async function setUpAdmin() {
  const admin = new Client();
  const { status, data } = await admin.call("/api/public/admin-setup", {
    password: "initial-password",
    username: "Jay",
    wechatNickname: "Jay微信",
  });
  if (status !== 200) throw new Error(`setup failed: ${JSON.stringify(data)}`);
  const adminToken = tokenOf(data.adminLink);
  return { admin, adminToken, ownerLink: data.ownerLink as string, base: `/api/admin/${adminToken}` };
}

/** A Pacific calendar date `days` from today, YYYY-MM-DD. */
export function futureDate(days: number): string {
  // Calendar days from today in Pacific time, not days × 24 h: across the end of daylight saving
  // time 24 h short of midnight lands on the same date twice (10 and 11 days on 2026-10-22).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 申请加入 the only way left: signed in with a fresh Google account (or the one given), then the
 * application form. Answers like /api/auth/register: { id, pending } or an error.
 */
export async function googleJoin(
  username: string,
  wechatNickname: string,
  extra: Record<string, unknown> & { email?: string } = {},
) {
  const { email = `${crypto.randomUUID().slice(0, 8)}@gmail.com`, ...body } = extra;
  const cookie = await googleCookie(`google-${crypto.randomUUID()}`, email);
  const res = await request("/api/auth/register", cookie, { username, wechatNickname, ...body });
  return { status: res.status, data: (await res.json()) as any, cookie };
}

/**
 * A member from before 2026-11-04 who registered by email and so has a /m/ link: new members join
 * with Google only now, but these keep their links (and most tests drive members through them).
 */
export async function linkMember(username: string, wechatNickname = username, email?: string) {
  return createMember(env, {
    username,
    wechatNickname,
    status: "pending",
    email: email ?? `${crypto.randomUUID().slice(0, 8)}@example.com`,
  });
}

export async function approveMember(ctx: { admin: Client; base: string }, username: string) {
  const joined = await linkMember(username);
  const { data } = await ctx.admin.call(`${ctx.base}/members/${joined.id}/approve`, {});
  return { id: joined.id as string, base: `/api/m/${tokenOf(data.link)}` };
}

export async function createTestEvent(ctx: { admin: Client; base: string }, overrides: Record<string, unknown> = {}) {
  const { status, data } = await ctx.admin.call(`${ctx.base}/events`, {
    date: futureDate(7),
    startTime: "19:00",
    endTime: "21:00",
    location: "Bay Badminton Center",
    deadlineDays: 1,
    deadlineHours: 0,
    ...overrides,
  });
  if (status !== 200) throw new Error(`create event failed: ${JSON.stringify(data)}`);
  return data;
}

export const expire = (id: number) =>
  env.DB.prepare("UPDATE events SET deadline_at = ?, status = 'closed' WHERE id = ?")
    .bind(new Date(Date.now() - 60_000).toISOString(), id)
    .run();

/** Owner Jay plays; Alice brings Tom (absent); Bob comes alone. 4 registered, 3 attended. */
export async function billingScenario() {
  const ctx = await setUpAdmin();
  await ctx.admin.call(`${ctx.base}/settings/payment`, {
    password: "initial-password",
    venmoUsername: "@KeLi8916",
    venmoEmail: "Owner@Example.com",
    zelleAccount: "jay@example.com",
  });
  const e = await createTestEvent(ctx);
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active.find(
    (m: { isOwner: boolean }) => m.isOwner,
  ).id;
  await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, { memberId: owner, includeSelf: true, friends: [] });
  await new Client().call(`${alice.base}/events/${e.id}/signup`, { friends: ["Tom"] });
  await new Client().call(`${bob.base}/events/${e.id}/signup`, { friends: [] });
  await expire(e.id);
  const d = (await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data;
  const tom = d.roster.find((r: { name: string }) => r.name === "Tom");
  await ctx.admin.call(`${ctx.base}/events/${e.id}/attendance`, { registrationId: tom.id, attended: false });
  const fees = { courtTotal: "100", shuttleCount: 6, shuttlePrice: "3" }; // court 25.00, shuttle 18/3 = 6.00
  return { ...ctx, e, alice, bob, owner, fees, eb: `${ctx.base}/events/${e.id}` };
}

/** The admin pages as reached through a Google account (the Owner's or an organizer's). */
export const GOOGLE = "/api/admin/google";

/** A request through the Worker with the organizer feature switched on (or off). */
export const request = (path: string, cookie = "", body?: unknown, organizers = "1") =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: organizers },
    {} as ExecutionContext,
  );

export async function googleCookie(sub: string, email: string) {
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO member_sessions (id_hash, google_sub, email, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), sub, email, new Date(Date.now() + 3600_000).toISOString())
    .run();
  return `jb_member=${token}`;
}

/** Makes an approved member an organizer (or admin) signed in with Google; returns their session cookie. */
export async function appoint(memberId: string, name: string, role: "organizer" | "admin" = "organizer") {
  await env.DB.prepare("UPDATE members SET role = ?, role_since = ?, google_sub = ?, google_email = ? WHERE id = ?")
    .bind(role, new Date().toISOString(), `google-${name}`, `${name}@gmail.com`, memberId)
    .run();
  return googleCookie(`google-${name}`, `${name}@gmail.com`);
}
