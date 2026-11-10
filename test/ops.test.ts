import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forget, state } from "../ops/src/github";
import ops from "../ops/src/index";
import {
  canMoveTo,
  compareTags,
  type Env,
  type Job,
  nextTag,
  pickSites,
  progressOf,
  sign,
  sites,
  sitesFromStepName,
  unsign,
} from "../ops/src/logic";

/** 发布管理网站 badminton.llmat.dev: only Ke Li's account gets in, and it starts the Release workflow. */

const ENV: Env = {
  OPS_ORIGIN: "https://badminton.llmat.dev",
  GITHUB_REPO: "likefudan/jaysbadminton",
  MAIN_SITE_DOMAIN: "jaysbadminton.llmat.dev",
  OPS_GITHUB_TOKEN: "gh-token",
  OPS_EMAIL: "owner@example.com",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  OPS_SESSION_KEY: "session-key",
};
async function call(path: string, init: RequestInit = {}, env = ENV) {
  const ctx = createExecutionContext();
  const res = await ops.fetch(new Request(`https://badminton.llmat.dev${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const signedIn = async (email = "owner@example.com") => `__Host-ops=${await sign(ENV.OPS_SESSION_KEY!, email, 3600)}`;

afterEach(() => vi.restoreAllMocks());

describe("release site logic", () => {
  it("lists Jay's site first, then sites.json, with the Release workflow's ids", () => {
    const all = sites(ENV);
    expect(all[0]).toMatchObject({ id: "jays", domain: "jaysbadminton.llmat.dev" });
    expect(all.map((s) => s.id)).toContain("sbbc");
  });

  it("orders release tags, same-day ones after the first", () => {
    const tags = ["v2026.11.09.2", "v2026.11.10", "v2026.11.09", "v2026.10.30"];
    expect(tags.sort(compareTags)).toEqual(["v2026.10.30", "v2026.11.09", "v2026.11.09.2", "v2026.11.10"]);
  });

  it("names the next release like the workflow does, in Pacific time", () => {
    const now = new Date("2026-11-10T07:00:00Z"); // still Nov 9 in California
    expect(nextTag([], now)).toBe("v2026.11.09");
    expect(nextTag(["v2026.11.09", "v2026.11.09.2"], now)).toBe("v2026.11.09.3");
  });

  it("locks versions older than the migrations the site already has", () => {
    const newest = { "v2026.11.09": "0044_x.sql", "v2026.11.05": "0044_x.sql", "v2026.11.04.3": "0043_y.sql" };
    expect(canMoveTo("v2026.11.09", newest, "v2026.11.05")).toBe(true);
    expect(canMoveTo("v2026.11.09", newest, "v2026.11.04.3")).toBe(false);
    expect(canMoveTo("v2026.11.04.3", newest, "v2026.11.09")).toBe(true);
    expect(canMoveTo(null, newest, "v2026.11.04.3")).toBe(true);
  });

  it("accepts only known sites, in release order", () => {
    expect(pickSites(["sbbc", "jays"], sites(ENV))).toEqual(["jays", "sbbc"]);
    expect(pickSites(["nope"], sites(ENV))).toBeNull();
    expect(pickSites([], sites(ENV))).toBeNull();
    expect(pickSites("jays", sites(ENV))).toBeNull();
  });

  it("refuses altered or expired cookies", async () => {
    const c = await sign("k", "a@b.c", 60, 1_000_000);
    expect(await unsign("k", c, 1_000_000)).toBe("a@b.c");
    expect(await unsign("other", c, 1_000_000)).toBeNull();
    expect(await unsign("k", c.replace("a@b.c", "x@b.c"), 1_000_000)).toBeNull();
    expect(await unsign("k", c, 1_000_000 + 61_000)).toBeNull();
  });
});

describe("release site", () => {
  it("shows a Google sign-in to visitors and keeps the API closed", async () => {
    const page = await (await call("/")).text();
    expect(page).toContain('href="/login"');
    expect(page).not.toContain("/app.js");
    expect((await call("/api/state")).status).toBe(401);
  });

  it("sends sign-in to Google with this site's callback", async () => {
    const res = await call("/login");
    const url = new URL(res.headers.get("Location")!);
    expect(url.host).toBe("accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://badminton.llmat.dev/auth/callback");
    // The allowed email is not shown to visitors.
    expect(url.search).not.toContain("example.com");
    expect(url.searchParams.get("login_hint")).toBeNull();
    expect(res.headers.get("Set-Cookie")).toMatch(/__Host-ops-oauth=.*HttpOnly; Secure/);
  });

  it("rejects a callback whose state does not match", async () => {
    const res = await call("/auth/callback?state=forged&code=x");
    expect(res.headers.get("Location")).toBe("/?error=login");
  });

  it("lets nobody in while the allowed email is missing", async () => {
    const res = await call("/", { headers: { Cookie: await signedIn() } }, { ...ENV, OPS_EMAIL: undefined });
    expect(await res.text()).toContain("OPS_EMAIL");
  });

  it("does not accept another account's cookie", async () => {
    const res = await call("/api/state", { headers: { Cookie: await signedIn("someone@example.com") } });
    expect(res.status).toBe(401);
  });

  it("starts the Release workflow on main with the chosen sites and version", async () => {
    const asked: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      asked.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    });
    const post = async (body: unknown) =>
      call("/api/release", {
        method: "POST",
        headers: { Cookie: await signedIn(), Origin: ENV.OPS_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post({ sites: ["sbbc"], tag: "v2026.11.09" })).status).toBe(200);
    expect(asked[0]).toEqual({
      url: "https://api.github.com/repos/likefudan/jaysbadminton/actions/workflows/release.yml/dispatches",
      body: { ref: "main", inputs: { sites: "sbbc", tag: "v2026.11.09" } },
    });
    expect((await post({ sites: ["sbbc"], tag: "main; rm" })).status).toBe(400);
    expect((await post({ sites: ["sbbcx"] })).status).toBe(400);
    // A new version must name the commit the page listed.
    expect((await post({ sites: ["sbbc"], tag: null })).status).toBe(400);
    expect(asked).toHaveLength(1);
  });

  it("releases a new version only while main is the commit the page listed", async () => {
    const sha = "a".repeat(40);
    const dispatched: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/commits/main")) return Response.json({ sha });
      dispatched.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    });
    const post = async (main: string) =>
      call("/api/release", {
        method: "POST",
        headers: { Cookie: await signedIn(), Origin: ENV.OPS_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ sites: sites(ENV).map((s) => s.id), tag: null, main }),
      });
    const moved = await post("b".repeat(40));
    expect(moved.status).toBe(409);
    expect(await moved.json()).toMatchObject({ moved: true });
    expect(dispatched).toHaveLength(0);
    expect((await post(sha)).status).toBe(200);
    expect(dispatched).toEqual([{ ref: "main", inputs: { sites: "all", expect: sha } }]);
  });

  it("refuses changes sent from another site", async () => {
    const res = await call("/api/release", {
      method: "POST",
      headers: { Cookie: await signedIn(), Origin: "https://evil.example" },
      body: JSON.stringify({ sites: ["jays"] }),
    });
    expect(res.status).toBe(403);
  });

  it("serves its script with a strict content policy and working tag checks", async () => {
    const res = await call("/app.js");
    const js = await res.clone().text();
    const tagRe = new RegExp(JSON.parse(/new RegExp\((".*?")\)/.exec(js)![1]!));
    expect(tagRe.test("v2026.11.09.2")).toBe(true);
    expect(tagRe.test("vX026.11.09")).toBe(false);
    expect(res.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("shows each site's version and which versions it may move to", async () => {
    const migrations: Record<string, string[]> = {
      "v2026.11.12": ["0044_a.sql", "0045_b.sql"],
      "v2026.11.11": ["0044_a.sql"],
      "v2026.11.09": ["0044_a.sql"],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const p = url.pathname.replace("/repos/likefudan/jaysbadminton", "");
      const ok = (body: unknown) => Response.json(body);
      if (p === "/api/health") {
        const v = { "jaysbadminton.llmat.dev": "v2026.11.12", "sbbc.llmat.dev": "v2026.11.11" }[url.host];
        return url.host === "coco.llmat.dev" ? new Response("down", { status: 502 }) : ok({ ok: true, version: v });
      }
      if (p === "/releases")
        return ok(
          Object.keys(migrations).map((t) => ({ tag_name: t, published_at: "2026-11-12T00:00:00Z", draft: false })),
        );
      if (p === "/commits/main") return ok({ sha: "abc" });
      if (p === "/actions/workflows/ci.yml/runs" && url.searchParams.get("branch"))
        return ok({ workflow_runs: [{ head_sha: "abc", status: "completed", conclusion: "success" }] });
      if (p.endsWith("/runs")) return ok({ workflow_runs: [] });
      if (p.startsWith("/compare/"))
        return ok({ ahead_by: 1, commits: [{ commit: { message: "新功能 (#300)\n\nbody" } }] });
      if (p === "/contents/migrations") return ok(migrations[url.searchParams.get("ref")!]!.map((name) => ({ name })));
      if (p === "/contents/.github/workflows/ci.yml") {
        const inputs = url.searchParams.get("ref") === "v2026.11.09" ? "" : "      sites:\n        type: string\n";
        return ok({ content: btoa(`on:\n  workflow_dispatch:\n    inputs:\n${inputs}`) });
      }
      if (p === "/tags") return ok([{ name: "v2026.11.12" }]);
      throw new Error(`unexpected ${url}`);
    });
    forget();
    const s = await state(ENV);
    expect(s.latest).toBe("v2026.11.12");
    expect(s.pending).toEqual(["新功能"]);
    expect(s.mainCi).toBe("success");
    expect(s.main).toBe("abc");
    const [jays, sbbc] = s.sites;
    expect(jays).toMatchObject({ version: "v2026.11.12", behind: 0, ok: true });
    // Jay's has run 0045: v2026.11.11 lacks it; v2026.11.09 predates per-site releases.
    expect(jays?.movable).toEqual(["v2026.11.12"]);
    expect(sbbc).toMatchObject({ behind: 1, movable: ["v2026.11.12", "v2026.11.11"] });
    expect(s.sites.find((x) => x.id === "coco")).toMatchObject({ ok: false, version: null });
    expect(s.versions.find((v) => v.tag === "v2026.11.09")?.perSite).toBe(false);
  });

  it("tells the developers' group when a release is started here", async () => {
    const sent: { url: string; body: { chat_id?: string; text?: string } }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 204 });
    });
    const res = await call(
      "/api/release",
      {
        method: "POST",
        headers: { Cookie: await signedIn(), Origin: ENV.OPS_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ sites: ["sbbc", "coco"], tag: "v2026.11.10" }),
      },
      { ...ENV, TELEGRAM_DEV_BOT_TOKEN: "dev-bot", TELEGRAM_DEV_CHAT_ID: "-100" },
    );
    expect(res.status).toBe(200);
    const notice = sent.find((m) => m.url === "https://api.telegram.org/botdev-bot/sendMessage");
    expect(notice?.body.chat_id).toBe("-100");
    expect(notice?.body.text).toContain("把 v2026.11.10 发到 SBBC 羽毛球、Coco 羽毛球");
  });
});

describe("release progress", () => {
  const ids = ["jays", "sbbc", "coco"];
  const done = (name: string): Job => ({ name, status: "completed", conclusion: "success" });
  const tests = ["check", "unit-2", "e2e", "e2e-2"].map(done);

  it("reads the chosen sites from the step name", () => {
    expect(sitesFromStepName("Sites: all", ids)).toEqual(ids);
    expect(sitesFromStepName("Sites: ", ids)).toEqual(ids);
    expect(sitesFromStepName("Check the sites: SBBC，coco", ids)).toEqual(["sbbc", "coco"]);
    expect(sitesFromStepName("Run npm ci", ids)).toBeNull();
  });

  it("shows tests, then Jay's first, then each site's step", () => {
    const running: Job[] = [{ name: "check", status: "in_progress", conclusion: null }];
    expect(progressOf(running, ["jays", "sbbc"]).sbbc).toEqual({ done: 0, label: "测试中", failed: false });

    const jays: Job = {
      name: "deploy-production",
      status: "in_progress",
      conclusion: null,
      steps: [
        { name: "Back up the production database", status: "completed", conclusion: "success" },
        { name: "Run npx wrangler d1 migrations apply DB --remote", status: "completed", conclusion: "success" },
        { name: "Run npx wrangler deploy", status: "in_progress", conclusion: null },
      ],
    };
    const p = progressOf([...tests, jays], ["jays", "sbbc"]);
    expect(p.jays).toEqual({ done: 3, label: "部署中", failed: false });
    expect(p.sbbc).toEqual({ done: 1, label: "等 Jay's 先发", failed: false });
    expect(progressOf([...tests], ["sbbc"]).sbbc.label).toBe("排队中");

    const failed: Job = {
      name: "deploy-sites (sbbc)",
      status: "completed",
      conclusion: "failure",
      steps: [
        { name: "Back up the site's database", status: "completed", conclusion: "success" },
        { name: "Run npx wrangler d1 migrations apply DB --remote", status: "completed", conclusion: "failure" },
      ],
    };
    const q = progressOf([...tests, done("deploy-production"), failed], ["jays", "sbbc"]);
    expect(q.jays).toEqual({ done: 5, label: "完成", failed: false });
    expect(q.sbbc).toEqual({ done: 2, label: "迁移失败", failed: true });

    const red = progressOf([{ name: "e2e", status: "completed", conclusion: "failure" }], ["coco"]);
    expect(red.coco).toEqual({ done: 0, label: "测试没通过", failed: true });
  });
});
