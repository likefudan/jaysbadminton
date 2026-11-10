import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toPacific } from "../src/shared/time";
import { Client, approveMember, createTestEvent, googleJoin, request, setUpAdmin } from "./helpers";

const anon = new Client();
const today = toPacific(new Date()).date;
const GOOGLE_PIC = "https://lh3.googleusercontent.com/a/abc=s96-c";
/** A few bytes that start like a JPEG: the server only checks the start and the size. */
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4));

const me = async (base: string) => (await anon.call(`${base}/me`)).data;
const post = (base: string, path: string, body: unknown) => anon.call(`${base}${path}`, body).then((r) => r.status);

describe("头像", () => {
  it("starts empty without Google, takes a photo, serves it, and goes back to none", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    expect(await me(alice.base)).toMatchObject({ avatar: null, avatarMode: "google", googlePicture: false });

    // Not a JPEG, too big, or nothing at all: refused.
    expect(await post(alice.base, "/avatar", { image: btoa("GIF89a") })).toBe(400);
    expect(await post(alice.base, "/avatar", { image: btoa(`\xff\xd8${"x".repeat(160_000)}`) })).toBe(400);
    expect(await post(alice.base, "/avatar", {})).toBe(400);

    const { data } = await anon.call(`${alice.base}/avatar`, { image: JPEG });
    expect(data.avatar).toMatch(/^\/api\/public\/avatars\/[\w-]+$/);
    expect(await me(alice.base)).toMatchObject({ avatar: data.avatar, avatarMode: "own" });
    const res = await request(data.avatar);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect([...new Uint8Array(await res.arrayBuffer())].slice(0, 2)).toEqual([0xff, 0xd8]);

    // A new photo gets a new address; the old one is gone.
    const second = (await anon.call(`${alice.base}/avatar`, { image: JPEG })).data.avatar;
    expect(second).not.toBe(data.avatar);
    expect((await request(data.avatar)).status).toBe(404);

    expect(await post(alice.base, "/avatar/mode", { mode: "nope" })).toBe(400);
    expect(await post(alice.base, "/avatar/mode", { mode: "none" })).toBe(200);
    expect(await me(alice.base)).toMatchObject({ avatar: null, avatarMode: "none" });
    expect((await request(second)).status).toBe(404);
  });

  it("uses the Google picture by default, from each sign-in, and keeps it when they pick none", async () => {
    const ctx = await setUpAdmin();
    const joined = await googleJoin("Mia", "Mia微信");
    await ctx.admin.call(`${ctx.base}/members/${joined.data.id}/approve`, {});
    const sub = (await env.DB.prepare("SELECT google_sub FROM members WHERE id = ?")
      .bind(joined.data.id)
      .first<{ google_sub: string }>())!.google_sub;
    // What the sign-in saves (the OAuth exchange itself isn't run in tests).
    await env.DB.prepare("UPDATE members SET google_picture = ? WHERE google_sub = ?").bind(GOOGLE_PIC, sub).run();
    const mine = async () => (await (await request("/api/m/session/me", joined.cookie)).json()) as any;
    expect(await mine()).toMatchObject({ avatar: GOOGLE_PIC, avatarMode: "google", googlePicture: true });

    expect((await request("/api/m/session/avatar/mode", joined.cookie, { mode: "none" })).status).toBe(200);
    expect(await mine()).toMatchObject({ avatar: null, avatarMode: "none", googlePicture: true });
    expect((await request("/api/m/session/avatar", joined.cookie, { image: JPEG })).status).toBe(200);
    expect((await mine()).avatarMode).toBe("own");
    expect((await request("/api/m/session/avatar/mode", joined.cookie, { mode: "google" })).status).toBe(200);
    expect(await mine()).toMatchObject({ avatar: GOOGLE_PIC, avatarMode: "google" });
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM member_avatars").first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it("shows on the boards and in 最常一起打球, to members only", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const e = await createTestEvent(ctx);
    await anon.call(`${alice.base}/events/${e.id}/signup`, { friends: [] });
    await anon.call(`${bob.base}/events/${e.id}/signup`, { friends: [] });
    await env.DB.prepare("UPDATE events SET status = 'settled', date = ? WHERE id = ?").bind(today, e.id).run();
    await env.DB.prepare("UPDATE members SET google_picture = ? WHERE id = ?").bind(GOOGLE_PIC, bob.id).run();
    const photo = (await anon.call(`${alice.base}/avatar`, { image: JPEG })).data.avatar;

    const { board } = (await ctx.admin.call(`${ctx.base}/leaderboard`)).data;
    expect(board.attendance.map((r: any) => [r.name, r.avatar])).toEqual([
      ["Alice", photo],
      ["Bob", GOOGLE_PIC],
    ]);
    expect((await anon.call(`${alice.base}/year`)).data.buddies).toEqual([
      { name: "Bob", count: 1, avatar: GOOGLE_PIC },
    ]);

    // 没登录也能看: visitors get the names without faces.
    await ctx.admin.call(`${ctx.base}/settings`, { leaderboardBoards: ["attendance"], leaderboardAnon: true });
    const visitor = (await anon.call("/api/public/home")).data.leaderboard;
    expect(visitor.attendance.map((r: any) => r.name)).toEqual(["Alice", "Bob"]);
    expect(visitor.attendance.every((r: any) => !("avatar" in r))).toBe(true);
  });

  it("lets go of the photo when the member is deleted", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const photo = (await anon.call(`${alice.base}/avatar`, { image: JPEG })).data.avatar;
    await ctx.admin.call(`${ctx.base}/members/${alice.id}/deactivate`, {});
    expect((await ctx.admin.call(`${ctx.base}/members/${alice.id}/delete`, {})).status).toBe(200);
    expect((await request(photo)).status).toBe(404);
    const row = await env.DB.prepare("SELECT avatar, google_picture FROM members WHERE id = ?").bind(alice.id).first();
    expect(row).toEqual({ avatar: null, google_picture: null });
  });
});
