import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/worker/index";
import { ORIGIN } from "./helpers";

// The app's page, as the static files hold it.
const assets = {
  fetch: async () =>
    new Response("<!doctype html><html><head><title>x</title></head><body></body></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
} as unknown as Fetcher;

const get = async (path: string, headers: Record<string, string> = {}) => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), { ...env, ASSETS: assets }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};
const boot = (html: string) => /<script type="application\/json" id="boot">(.*?)<\/script>/.exec(html)?.[1];

describe("pages of the app", () => {
  it("come with the site and the session written in, on any page address", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('site_title', '</script><b>')").run();
    for (const path of ["/", "/me", "/admin/some-token", "/board", "/no/such/page"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const json = boot(await res.text());
      expect(json, path).toBeTruthy();
      // Nothing in it can end the script element early.
      expect(json).not.toContain("<");
      const data = JSON.parse(json!);
      expect(data["/api/auth/session"]).toMatchObject({ signedIn: false, hasMember: false });
      expect(data["/api/public/site"]).toMatchObject({ title: "</script><b>", staging: false });
    }
  });

  it("says the same as the two addresses it stands in for", async () => {
    const data = JSON.parse(boot(await (await get("/me")).text())!);
    expect(data["/api/public/site"]).toEqual(await (await get("/api/public/site")).json());
    expect(data["/api/auth/session"]).toEqual(await (await get("/api/auth/session")).json());
  });

  it("come plain when asked", async () => {
    expect(boot(await (await get("/me", { "X-Plain-Page": "1" })).text())).toBeUndefined();
  });

  it("are not the answer for a file that is gone, nor for the API", async () => {
    for (const path of ["/assets/index-old.js", "/old-icon.png", "/api/nothing", "/export/x"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});
