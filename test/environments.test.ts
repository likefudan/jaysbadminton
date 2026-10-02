import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { forwardingWatch } from "../src/worker/health";
import worker from "../src/worker/index";
import { withShareMeta } from "../src/worker/share";
import { ORIGIN } from "./helpers";

/** Calls the Worker as one environment or the other (tests otherwise run with no ENVIRONMENT). */
async function call(path: string, environment: "production" | "staging") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`), { ...env, ENVIRONMENT: environment }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("test site vs production", () => {
  it("tells the page it is the test site, and hides it from search engines", async () => {
    const staging = await call("/api/public/site", "staging");
    expect((await staging.json<{ staging: boolean }>()).staging).toBe(true);
    expect(staging.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(await (await call("/robots.txt", "staging")).text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("leaves production as it was: indexable, no banner, private paths kept out of search", async () => {
    const prod = await call("/api/public/site", "production");
    expect((await prod.json<{ staging: boolean }>()).staging).toBe(false);
    expect(prod.headers.get("X-Robots-Tag")).toBeNull();
    const robots = await (await call("/robots.txt", "production")).text();
    expect(robots).toContain("Disallow: /m/");
    expect(robots).not.toContain("Disallow: /\n");
  });

  it("marks link previews from the test site", async () => {
    const shell = new Response("<html><head><title>x</title></head></html>", { headers: { "Content-Type": "text/html" } });
    const html = await withShareMeta(shell, { title: "活动", description: "d", url: "u" }, "https://s", true).text();
    expect(html).toContain("<title>【测试】活动</title>");
  });

  it("never warns about Venmo forwarding on the test site, which gets no real mail", async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('venmo_username', 'x')").run();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_log").first<{ n: number }>();
    await forwardingWatch({ ...env, ENVIRONMENT: "staging" }, new Date(), { reminderEnabled: true, reminderHours: 6, dunningHour: new Date().getUTCHours(), weeklyDigest: false });
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM notification_log").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});
