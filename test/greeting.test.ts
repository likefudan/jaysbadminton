import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, approveMember, setUpAdmin } from "./helpers";

/** 我的活动页的问候语 (Ke Li 2026-11-12): an admin setting the member page reads from /me. */
describe("问候语", () => {
  it("is big by default, saved by an admin, refused when unknown, and logged", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const me = async () => (await new Client().call(`${alice.base}/me`)).data.greeting;
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.greeting).toBe("big");
    expect(await me()).toBe("big");

    expect((await ctx.admin.call(`${ctx.base}/settings`, { greeting: "small" })).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/settings`)).data.greeting).toBe("small");
    expect(await me()).toBe("small");
    expect((await ctx.admin.call(`${ctx.base}/settings`, { greeting: "none" })).status).toBe(200);
    expect(await me()).toBe("none");

    expect((await ctx.admin.call(`${ctx.base}/settings`, { greeting: "huge" })).status).toBe(400);
    expect(await me()).toBe("none");
    const log = await env.DB.prepare("SELECT detail FROM group_audit WHERE action = 'settings' ORDER BY at DESC").all<{
      detail: string;
    }>();
    expect(log.results.map((r) => r.detail).join("\n")).toContain("我的活动页问候语 不显示");
  });
});
