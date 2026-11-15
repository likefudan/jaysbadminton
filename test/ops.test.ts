import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forget, state } from "../ops/src/github";
import { langOf, MESSAGES, tr } from "../ops/src/i18n";
import ops from "../ops/src/index";
import {
  canMoveTo,
  compareTags,
  type Env,
  type Job,
  nextTag,
  parseNotes,
  pickSites,
  progressOf,
  sign,
  sites,
  sitesFromStepName,
  unsign,
} from "../ops/src/logic";
import { APP_JS } from "../ops/src/page";
import { MAX_PENDING, MAX_USERS, roleOf, type Storage, UserBook } from "../ops/src/users";

/** 发布管理网站 badminton.llmat.dev: Ke Li owns it, approves others, and it starts the Release workflow. */

/** Durable Object storage as a Map, for UserBook. */
function memory(): Storage & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async <T>(k: string) => map.get(k) as T | undefined,
    put: async (k, v) => void map.set(k, structuredClone(v)),
    delete: async (k) => map.delete(k),
    list: async <T>({ prefix }: { prefix: string }) =>
      new Map([...map].filter(([k]) => k.startsWith(prefix))) as Map<string, T>,
  };
}
// The USERS namespace: every stub is the same UserBook, emptied before each test.
let users = new UserBook(memory());
const USERS = { idFromName: () => "users", get: () => users } as unknown as Env["USERS"];

const ENV: Env = {
  OPS_ORIGIN: "https://badminton.llmat.dev",
  GITHUB_REPO: "likefudan/jaysbadminton",
  MAIN_SITE_DOMAIN: "jaysbadminton.llmat.dev",
  OPS_GITHUB_TOKEN: "gh-token",
  OPS_EMAIL: "owner@example.com",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  OPS_SESSION_KEY: "session-key",
  OWNER_NAME: "Ke Li",
  USERS,
};
async function call(path: string, init: RequestInit = {}, env = ENV) {
  const ctx = createExecutionContext();
  const res = await ops.fetch(new Request(`https://badminton.llmat.dev${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const signedIn = async (email = "owner@example.com") => `__Host-ops=${await sign(ENV.OPS_SESSION_KEY!, email, 3600)}`;

afterEach(() => {
  vi.restoreAllMocks();
  users = new UserBook(memory());
});

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
    // Back past a rollback-safe migration: Release sets it aside, no restore needed.
    const two = { "v2026.11.10.7": "0047_likes.sql", "v2026.11.10.6": "0046_avatars.sql" };
    const names = ["0045_q.sql", "0046_avatars.sql", "0047_likes.sql"];
    expect(canMoveTo("v2026.11.10.7", two, "v2026.11.10.6", names)).toBe(false);
    expect(canMoveTo("v2026.11.10.7", two, "v2026.11.10.6", names, { "0047_likes.sql": "" })).toBe(true);
    expect(
      canMoveTo("v2026.11.10.7", newest, "v2026.11.04.3", ["0044_x.sql", "0047_likes.sql"], { "0047_likes.sql": "" }),
    ).toBe(true);
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

  it("lets another account in only to apply", async () => {
    const res = await call("/api/state", { headers: { Cookie: await signedIn("someone@example.com") } });
    expect(res.status).toBe(403);
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
    // Not no-referrer: then browsers send "Origin: null" on form posts and /apply, /logout get refused.
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
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
  const tests = ["check", "unit-2", "e2e", "e2e-2", "e2e-3"].map(done);

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
    expect(progressOf([...tests], ["sbbc"]).sbbc?.label).toBe("排队中");

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

describe("all versions and their notes", () => {
  it("turns GitHub's generated notes into titles with their PR numbers", () => {
    const body =
      "## What's Changed\n* 排行榜拖动排序加动画 by @likefudan in https://github.com/likefudan/jaysbadminton/pull/245\n" +
      "- 手写的一行 **说明**\n\n\n**Full Changelog**: https://github.com/likefudan/jaysbadminton/compare/a...b";
    expect(parseNotes(body)).toEqual([
      { text: "排行榜拖动排序加动画", pr: 245 },
      { text: "手写的一行 说明", pr: null },
    ]);
    expect(parseNotes(null)).toEqual([]);
  });

  it("lists published versions page by page, signed in only", async () => {
    expect((await call("/api/releases")).status).toBe(401);
    const asked: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      asked.push(String(input));
      return Response.json([
        {
          tag_name: "v2026.11.10.6",
          published_at: "2026-11-11T04:27:49Z",
          draft: false,
          body: "* A by @x in https://github.com/o/r/pull/9",
          html_url: "https://github.com/o/r/releases/tag/v2026.11.10.6",
        },
        { tag_name: "v2026.11.11", published_at: "2026-11-11T05:00:00Z", draft: true, body: "", html_url: "" },
      ]);
    });
    const res = await call("/api/releases?page=2", { headers: { Cookie: await signedIn() } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { releases: { tag: string; notes: unknown[] }[]; more: boolean };
    expect(body.releases.map((r) => r.tag)).toEqual(["v2026.11.10.6"]);
    expect(body.releases[0]?.notes).toEqual([{ text: "A", pr: 9 }]);
    expect(body.more).toBe(false);
    expect(asked[0]).toContain("/releases?per_page=20&page=2");
    expect((await call("/api/releases?page=0", { headers: { Cookie: await signedIn() } })).status).toBe(400);
  });
});

describe("restore a site's database, then change its version", () => {
  it("starts Restore for one site only when its id is typed", async () => {
    const asked: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      asked.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(null, { status: 204 });
    });
    const post = async (body: unknown) =>
      call("/api/restore", {
        method: "POST",
        headers: { Cookie: await signedIn(), Origin: ENV.OPS_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await post({ site: "sbbc", tag: "v2026.11.10.4", confirm: "jays" })).status).toBe(400);
    expect((await post({ site: "nope", tag: "v2026.11.10.4", confirm: "nope" })).status).toBe(400);
    expect((await post({ site: "sbbc", tag: "v1; rm", confirm: "sbbc" })).status).toBe(400);
    expect(asked).toHaveLength(0);
    expect((await post({ site: "sbbc", tag: "v2026.11.10.4", confirm: "sbbc" })).status).toBe(200);
    expect(asked[0]).toEqual({
      url: "https://api.github.com/repos/likefudan/jaysbadminton/actions/workflows/restore.yml/dispatches",
      body: { ref: "main", inputs: { site: "sbbc", tag: "v2026.11.10.4", confirm: "sbbc" } },
    });
  });
});

describe("简 / 繁 / English", () => {
  it("has both translations for every text the page script and the progress labels use", () => {
    const keys = [...APP_JS.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    keys.push(...["测试", "备份", "迁移", "部署", "检查"].flatMap((s) => [s, `${s}中`, `${s}失败`]));
    keys.push("测试没通过", "等 Jay's 先发", "排队中", "完成", "没有部署", "恢复中", "准备中");
    // The 用户和权限 panel's statuses and buttons, which go through t() as variables.
    const panel = APP_JS.slice(APP_JS.indexOf("const STATUS ="), APP_JS.indexOf("function openUsers"));
    keys.push(...[...panel.matchAll(/"([^"]*[\u4e00-\u9fff][^"]*)"/g)].map((m) => m[1]!));
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) expect(MESSAGES[k], k).toBeTruthy();
    for (const [k, m] of Object.entries(MESSAGES)) {
      expect(m.en, k).not.toMatch(/[\u4e00-\u9fff]/);
      expect(m.tw, k).toBeTruthy();
      // The same {placeholders} in every language.
      const holes = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((x) => x[0]).sort();
      expect(holes(m.en), k).toEqual(holes(k));
      expect(holes(m.tw), k).toEqual(holes(k));
    }
    // The script fills in {placeholders} and strips 羽毛球 (backslashes survive the template string).
    expect(APP_JS).toContain(String.raw`.replace(/\{(\w+)\}/g`);
    expect(APP_JS).toContain(String.raw`.replace(/\s*羽毛球$/, " Badminton")`);
    // The script still parses with the texts in it.
    expect(() => new Function(APP_JS)).not.toThrow();
  });

  it("picks the saved language, else 繁體 for Traditional Chinese browsers and 简体 for the rest", () => {
    const req = (h: Record<string, string>) => new Request("https://x/", { headers: h });
    expect(langOf(req({ Cookie: "a=b; ops-lang=en" }))).toBe("en");
    expect(langOf(req({ "Accept-Language": "zh-TW,zh;q=0.9" }))).toBe("zh-TW");
    expect(langOf(req({ "Accept-Language": "en-US,en;q=0.9" }))).toBe("zh-CN");
    expect(langOf(req({ Cookie: "ops-lang=xx" }))).toBe("zh-CN");
    expect(tr("en", "落后 {n}", { n: 2 })).toBe("2 behind");
  });

  it("remembers the choice from the 文A menu and draws the page in it", async () => {
    const res = await call("/lang/en");
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("Set-Cookie")).toMatch(/^ops-lang=en; Path=\/; Max-Age=\d+; Secure; SameSite=Lax$/);
    expect((await call("/lang/fr")).headers.get("Set-Cookie")).toBeNull();
    const page = await (await call("/?error=account", { headers: { Cookie: "ops-lang=en" } })).text();
    expect(page).toContain('<html lang="en">');
    expect(page).toContain("<title>Release Service</title>");
    expect(page).toContain("Sign in with Google");
    expect(page).toContain("This Google account can't be used (its email isn't verified).");
    expect(page).toContain('href="/lang/zh-TW"');
    const zh = await (await call("/")).text();
    expect(zh).toContain("<title>站点发布管理</title>");
    const res2 = await call("/api/state", { headers: { Cookie: "ops-lang=zh-TW" } });
    expect(await res2.json()).toEqual({ error: "請先登入" });
  });
});

describe("users: apply, approve, release engineers", () => {
  const as = async (email: string, path: string, init: RequestInit = {}, env = ENV) =>
    call(path, { ...init, headers: { Cookie: await signedIn(email), Origin: ENV.OPS_ORIGIN, ...init.headers } }, env);
  const apply = (email: string, fields: Record<string, string>, env = ENV) =>
    as(email, "/apply", { method: "POST", body: new URLSearchParams(fields) }, env);
  const decide = (email: string, action: string, by = "owner@example.com") =>
    as(by, "/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, action }),
    });
  const releaseAs = (email: string) =>
    as(email, "/api/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sites: ["sbbc"], tag: "v2026.11.10" }),
    });
  const restoreAs = (email: string) =>
    as(email, "/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "sbbc", tag: "v2026.11.10", confirm: "sbbc" }),
    });

  it("keeps the list: one application per account, a cap, decisions, removal", async () => {
    const book = new UserBook(memory());
    const first = await book.apply("a@x.com", "  Amy\u0007  ", "hi\nthere", new Date("2026-11-15T00:00:00Z"));
    expect(first).toMatchObject({ ok: true, isNew: true, user: { name: "Amy", note: "hi there", status: "pending" } });
    // Still waiting: the note may change, the first time stays.
    const again = await book.apply("a@x.com", "", "new note");
    expect(again).toMatchObject({ ok: true, isNew: false, user: { name: "Amy", note: "new note" } });
    expect(again.ok && again.user.appliedAt).toBe("2026-11-15T00:00:00.000Z");
    expect((await book.apply("b@x.com", "B".repeat(100), "n".repeat(500))).ok && true).toBe(true);
    expect((await book.get("b@x.com"))?.name).toHaveLength(60);
    expect((await book.get("b@x.com"))?.note).toHaveLength(200);
    await book.decide("a@x.com", "engineer");
    expect(await book.apply("a@x.com", "Amy", "")).toEqual({ ok: false, reason: "decided" });
    expect((await book.list()).map((u) => u.status)).toEqual(["pending", "engineer"]);
    expect(await book.decide("nobody@x.com", "viewer")).toBeNull();
    expect(await book.remove("a@x.com")).toBe(true);
    expect(await book.get("a@x.com")).toBeNull();

    // Waiting applications are capped; decided ones count only toward the overall cap.
    const full = new UserBook(memory());
    for (let i = 0; i < MAX_PENDING; i++) await full.apply(`u${i}@x.com`, "U", "");
    expect(await full.apply("late@x.com", "L", "")).toEqual({ ok: false, reason: "full" });
    await full.decide("u0@x.com", "rejected");
    expect((await full.apply("late@x.com", "L", "")).ok).toBe(true);
    for (let i = MAX_PENDING; i < MAX_USERS + 5; i++) {
      await full.apply(`u${i}@x.com`, "U", "");
      await full.decide(`u${i}@x.com`, "rejected");
    }
    expect(await full.apply("later@x.com", "L", "")).toEqual({ ok: false, reason: "full" });
  });

  it("gives the owner every power and others only what they were approved for", () => {
    const u = (status: "pending" | "viewer" | "engineer" | "rejected") =>
      ({ email: "a@x.com", name: "", note: "", status, appliedAt: "", decidedAt: null }) as const;
    expect(roleOf("owner@example.com", " Owner@example.com ", null)).toBe("owner");
    // A stored entry never changes the owner, and the owner's email in it gives nothing to others.
    expect(roleOf("owner@example.com", "owner@example.com", u("rejected"))).toBe("owner");
    expect(roleOf("a@x.com", "owner@example.com", u("engineer"))).toBe("engineer");
    expect(roleOf("a@x.com", "owner@example.com", u("viewer"))).toBe("viewer");
    expect(roleOf("a@x.com", "owner@example.com", u("pending"))).toBeNull();
    expect(roleOf("a@x.com", "owner@example.com", u("rejected"))).toBeNull();
    expect(roleOf("a@x.com", "owner@example.com", null)).toBeNull();
  });

  it("shows a new account the application form and nothing else", async () => {
    const page = await (await as("new@x.com", "/")).text();
    expect(page).toContain('action="/apply"');
    expect(page).not.toContain("/app.js");
    expect(page).toContain("Ke Li 批准了你才能查看");
    for (const path of ["/api/state", "/api/releases", "/api/users"])
      expect((await as("new@x.com", path)).status).toBe(403);
    expect((await releaseAs("new@x.com")).status).toBe(403);
  });

  it("takes an application, tells the developers' group once, and shows it waiting", async () => {
    const sent: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)).text);
      return new Response(null, { status: 204 });
    });
    const env = { ...ENV, TELEGRAM_DEV_BOT_TOKEN: "dev-bot", TELEGRAM_DEV_CHAT_ID: "-100" };
    expect((await apply("new@x.com", { name: " " }, env)).headers.get("Location")).toBe("/?error=name");
    expect(await users.get("new@x.com")).toBeNull();
    const res = await apply("new@x.com", { name: "Nina", note: "我是 SBBC 的组织者" }, env);
    expect(res.headers.get("Location")).toBe("/");
    await apply("new@x.com", { name: "Nina", note: "改一下说明" }, env);
    expect(sent).toEqual([
      "📝 Nina（new@x.com）申请使用发布管理网站：我是 SBBC 的组织者\n请到 https://badminton.llmat.dev 审核",
    ]);
    const page = await (await as("new@x.com", "/")).text();
    expect(page).toContain("申请已提交");
    expect(page).toContain("改一下说明");
    expect(page).not.toContain('action="/apply"');
    // From another site: refused like every change.
    const forged = await call("/apply", {
      method: "POST",
      headers: { Cookie: await signedIn("other@x.com"), Origin: "https://evil.example" },
      body: new URLSearchParams({ name: "X" }),
    });
    expect(forged.status).toBe(403);
    expect(await users.get("other@x.com")).toBeNull();
  });

  it("lets only the owner see and decide applications", async () => {
    await users.apply("a@x.com", "Amy", "");
    await users.apply("b@x.com", "Bob", "");
    await users.decide("b@x.com", "engineer");
    expect((await as("b@x.com", "/api/users")).status).toBe(403);
    expect((await decide("a@x.com", "engineer", "b@x.com")).status).toBe(403);
    expect((await users.get("a@x.com"))?.status).toBe("pending");

    const list = (await (await as("owner@example.com", "/api/users")).json()) as { users: { email: string }[] };
    expect(list.users.map((u) => u.email)).toEqual(["a@x.com", "b@x.com"]);
    expect((await decide("a@x.com", "viewer")).status).toBe(200);
    expect((await users.get("a@x.com"))?.status).toBe("viewer");
    expect((await decide("a@x.com", "owner")).status).toBe(400);
    expect((await decide("owner@example.com", "rejected")).status).toBe(400);
    expect((await decide("ghost@x.com", "viewer")).status).toBe(404);
    expect((await decide("a@x.com", "remove")).status).toBe(200);
    expect(await users.get("a@x.com")).toBeNull();
  });

  it("lets viewers look but not release, roll back or restore", async () => {
    await users.apply("v@x.com", "Vic", "");
    await users.decide("v@x.com", "viewer");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([]));
    expect((await as("v@x.com", "/api/releases")).status).toBe(200);
    expect((await as("v@x.com", "/")).text()).resolves.toContain("/app.js");
    const refused = await releaseAs("v@x.com");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "只有发布工程师可以发布、回滚和恢复" });
    expect((await restoreAs("v@x.com")).status).toBe(403);
    // Only GitHub's release list was read: nothing was dispatched.
    expect(vi.mocked(fetch).mock.calls.every(([u]) => !String(u).includes("dispatches"))).toBe(true);
  });

  it("lets release engineers release and names them in the notice; taking access away is immediate", async () => {
    await users.apply("e@x.com", "Eve", "");
    await users.decide("e@x.com", "engineer");
    const sent: { url: string; text?: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      sent.push({ url: String(input), text: JSON.parse(String(init?.body)).text });
      return new Response(null, { status: 204 });
    });
    const env = { ...ENV, TELEGRAM_DEV_BOT_TOKEN: "dev-bot", TELEGRAM_DEV_CHAT_ID: "-100" };
    const res = await as(
      "e@x.com",
      "/api/release",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sites: ["sbbc"], tag: "v2026.11.10" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(sent.find((m) => m.url.includes("telegram"))?.text).toContain("🚀 Eve 从发布管理网站开始发布");
    expect((await restoreAs("e@x.com")).status).toBe(200);
    await decide("e@x.com", "rejected");
    expect((await releaseAs("e@x.com")).status).toBe(403);
    expect((await as("e@x.com", "/api/releases")).status).toBe(403);
    expect(await (await as("e@x.com", "/")).text()).toContain("这个账号没有权限");
  });
});
