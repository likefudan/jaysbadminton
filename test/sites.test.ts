import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker/index";
import { siteTitle } from "../src/worker/site";
import { botToken, saveBotToken, telegramStatus } from "../src/worker/telegram";
import { ORIGIN } from "./helpers";

/** An extra site from sites.json: its own name, and no bot token in the GitHub secrets. */
const site = { ...env, SITE_ID: "sbbc", SITE_NAME: "SBBC 羽毛球", TELEGRAM_BOT_TOKEN: undefined };
const TOKEN = "123456789:AAbbccddeeffgghhiijjkkllmmnnooppqq";

describe("each site names itself", () => {
  it("uses the site's own name until the Owner sets one", async () => {
    expect(await siteTitle(site)).toBe("SBBC 羽毛球");
    expect(await siteTitle(env)).toBe("Jay's 羽毛球");
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('site_title', 'South Bay')").run();
    expect(await siteTitle(site)).toBe("South Bay");
  });

  it("names the home-screen app after the site", async () => {
    const assets = {
      fetch: async () => Response.json({ name: "Jay's 羽毛球", short_name: "羽毛球", icons: [] }),
    } as unknown as Fetcher;
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`${ORIGIN}/manifest.webmanifest`), { ...site, ASSETS: assets }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(await res.json()).toEqual({ name: "SBBC 羽毛球", short_name: "羽毛球", icons: [] });
  });
});

describe("a site's own Telegram bot, saved in 设置", () => {
  let username = "sbbc_bot";
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.telegram.org/bot")) throw new Error(`unexpected fetch ${url}`);
      if (url.includes("/bot1:")) return Response.json({ ok: false, description: "Unauthorized" });
      return Response.json({ ok: true, result: { username } });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("is checked with Telegram, kept encrypted and then used", async () => {
    expect(await botToken(site)).toBeNull();
    expect((await telegramStatus(site, null)).botReady).toBe(false);
    expect(await saveBotToken(site, TOKEN)).toBe("sbbc_bot");
    expect(await botToken(site)).toBe(TOKEN);
    const stored = await env.DB.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token_enc'").first<{
      value: string;
    }>();
    expect(stored!.value).not.toContain(TOKEN);
    const status = await telegramStatus(site, null);
    expect(status).toMatchObject({ botReady: true, botInSettings: true, botUsername: "sbbc_bot" });
  });

  it("refuses a token Telegram doesn't know, or one that isn't a token at all", async () => {
    await expect(saveBotToken(site, "not a token")).rejects.toThrow("格式不对");
    await expect(saveBotToken(site, "1:AAbbccddeeffgghhiijjkkllmmnnooppqq")).rejects.toThrow("Unauthorized");
    expect(await botToken(site)).toBeNull();
  });

  it("disconnects everyone when the Owner switches to another bot", async () => {
    await saveBotToken(site, TOKEN);
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('telegram_chat_id', '42')").run();
    await saveBotToken(site, TOKEN); // the same bot again: nobody is disconnected
    expect((await telegramStatus(site, null)).connected).toBe(true);
    username = "other_bot";
    await saveBotToken(site, TOKEN);
    expect((await telegramStatus(site, null)).connected).toBe(false);
  });

  it("stays with the GitHub secret where the site has one", async () => {
    await expect(saveBotToken(env, TOKEN)).rejects.toThrow("GitHub secret");
    expect((await telegramStatus(env, null)).botInSettings).toBe(false);
  });
});

describe("the AI sponsor in the footer", () => {
  const site = async (vars: Record<string, string | undefined>) => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/public/site`), { ...env, ...vars }, ctx);
    await waitOnExecutionContext(ctx);
    return (await res.json<{ sponsor: unknown }>()).sponsor;
  };

  it("names the sponsor and its link when the site has one", async () => {
    expect(await site({ SPONSOR_NAME: "Z3 Enterprise", SPONSOR_URL: "https://www.z3enterprise.com/" })).toEqual({
      name: "Z3 Enterprise",
      url: "https://www.z3enterprise.com/",
    });
    expect(await site({ SPONSOR_NAME: "Acme", SPONSOR_URL: undefined })).toEqual({ name: "Acme", url: null });
  });

  it("says nothing when the site has none", async () => {
    expect(await site({ SPONSOR_NAME: undefined, SPONSOR_URL: "https://x.example/" })).toBeNull();
  });
});
