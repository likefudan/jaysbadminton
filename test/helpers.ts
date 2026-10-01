import { env, exports } from "cloudflare:workers";

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
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(Date.now() + days * 86400_000));
}

export async function approveMember(ctx: { admin: Client; base: string }, username: string) {
  const { data: joined } = await new Client().call("/api/public/join", { username, wechatNickname: username });
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
  env.DB.prepare("UPDATE events SET deadline_at = ?, status = 'closed' WHERE id = ?").bind(new Date(Date.now() - 60_000).toISOString(), id).run();

/** Owner Jay plays; Alice brings Tom (absent); Bob comes alone. 4 registered, 3 attended. */
export async function billingScenario() {
  const ctx = await setUpAdmin();
  await ctx.admin.call(`${ctx.base}/settings`, { venmoUsername: "@KeLi8916", zelleAccount: "jay@example.com" });
  const e = await createTestEvent(ctx);
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active.find((m: { isOwner: boolean }) => m.isOwner).id;
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

