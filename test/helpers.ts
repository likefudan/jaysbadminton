import { exports } from "cloudflare:workers";

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
