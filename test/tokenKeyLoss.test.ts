import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { currentAdminToken } from "../src/worker/auth";
import { encryptToken } from "../src/worker/lib/crypto";
import { Client, linkMember, setUpAdmin } from "./helpers";

/** What the database holds after TOKEN_KEY was replaced: values encrypted under another key. */
const underOldKey = () => encryptToken("some-old-secret", "the-key-that-was-lost");

describe("after TOKEN_KEY was replaced", () => {
  it("the Sheets card still loads and asks for a new key", async () => {
    const ctx = await setUpAdmin();
    await ctx.admin.call(`${ctx.base}/sheets/enable`, {});
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'export_key_enc'")
      .bind(await underOldKey())
      .run();
    const lost = await ctx.admin.call(`${ctx.base}/sheets`);
    expect(lost).toMatchObject({ status: 200, data: { enabled: true, script: null, keyLost: true } });
    expect((await ctx.admin.call(`${ctx.base}/sheets/enable`, {})).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/sheets`)).data).toMatchObject({ keyLost: false });
    expect((await ctx.admin.call(`${ctx.base}/sheets`)).data.script).toContain("const KEY");
  });

  it("Telegram's 管理页面 gets a new admin link instead of failing", async () => {
    await setUpAdmin();
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'admin_token_enc'")
      .bind(await underOldKey())
      .run();
    const { token, renewed } = await currentAdminToken(env);
    expect(renewed).toBe(true);
    expect(await currentAdminToken(env)).toEqual({ token, renewed: false });
  });

  it("a member's link says to make a new one, and 找回 answers like for anyone else", async () => {
    const ctx = await setUpAdmin();
    const joined = await linkMember("Alice", "Alice", "alice@example.com");
    await ctx.admin.call(`${ctx.base}/members/${joined.id}/approve`, {});
    await env.DB.prepare("UPDATE members SET token_enc = ? WHERE id = ?")
      .bind(await underOldKey(), joined.id)
      .run();
    const link = await ctx.admin.call(`${ctx.base}/members/${joined.id}/link`);
    expect(link).toMatchObject({ status: 409, data: { error: { code: "link_unreadable" } } });
    expect((await new Client().call("/api/public/recover-link", { email: "alice@example.com" })).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/members/${joined.id}/regenerate`, {})).status).toBe(200);
    expect((await ctx.admin.call(`${ctx.base}/members/${joined.id}/link`)).status).toBe(200);
  });
});
