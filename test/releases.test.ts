import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { compareTags, listReleases } from "../src/worker/releases";
import { GOOGLE, appoint, approveMember, request, setUpAdmin } from "./helpers";

/** 设置 → 版本和更新记录: this site's version and the releases CI recorded for it. */

const record = (tag: string, changes: string[], lines: unknown, at: string) =>
  env.DB.prepare("INSERT INTO release_notices (tag, changes, created_at, lines) VALUES (?, ?, ?, ?)")
    .bind(tag, JSON.stringify(changes), at, lines === undefined ? null : JSON.stringify(lines))
    .run();

describe("版本和更新记录", () => {
  it("orders tags like the release scripts", () => {
    const tags = ["v2026.11.10", "v2026.11.09.2", "v2026.11.09", "v2026.11.09.10", "v2026.10.21"];
    expect(tags.sort(compareTags)).toEqual([
      "v2026.10.21",
      "v2026.11.09",
      "v2026.11.09.2",
      "v2026.11.09.10",
      "v2026.11.10",
    ]);
  });

  it("lists releases newest first: Claude's lines, else the titles", async () => {
    // Claude's lines in three languages.
    await record(
      "v2026.11.10",
      ["名单默认收起 (internal)"],
      { "zh-CN": ["名单默认收起。"], "zh-TW": ["名單預設收起。"], en: ["The roster starts folded."], more: 0 },
      "2026-11-10T09:11:00.000Z",
    );
    // Sent without a model: the bare titles, cut to ten; the full list shows instead.
    const titles = Array.from({ length: 12 }, (_, i) => `改动 ${i + 1}`);
    const bare = titles.slice(0, 10);
    await record("v2026.11.09.2", titles, { "zh-CN": bare, "zh-TW": bare, en: bare, more: 2 }, "2026-11-10T01:00:00Z");
    // Not sent yet.
    await record("v2026.11.09", ["新建活动开关合成一个列表"], undefined, "2026-11-09T01:00:00Z");
    // Nothing users can see.
    await record("v2026.11.07", ["CI 提速"], { "zh-CN": [], "zh-TW": [], en: [], more: 0 }, "2026-11-07T10:00:00Z");
    // Not a release tag: left out.
    await record("test-tag", ["x"], undefined, "2026-11-11T00:00:00Z");

    const r = await listReleases({ ...env, APP_VERSION: "v2026.11.10" });
    expect(r.current).toBe("v2026.11.10");
    expect(r.releases.map((x) => x.tag)).toEqual(["v2026.11.10", "v2026.11.09.2", "v2026.11.09", "v2026.11.07"]);
    expect(r.releases[0]).toEqual({
      tag: "v2026.11.10",
      at: "2026-11-10T09:11:00.000Z",
      lines: { "zh-CN": ["名单默认收起。"], "zh-TW": ["名單預設收起。"], en: ["The roster starts folded."] },
      changes: [],
    });
    expect(r.releases[1]).toMatchObject({ lines: null, changes: titles });
    expect(r.releases[2]).toMatchObject({ lines: null, changes: ["新建活动开关合成一个列表"] });
    expect(r.releases[3]).toMatchObject({ lines: { "zh-CN": [], "zh-TW": [], en: [] }, changes: [] });

    // Without a deployed version (local, tests).
    expect((await listReleases({ ...env, APP_VERSION: undefined })).current).toBeNull();
  });

  it("is open to the Owner, admins and organizers, not to others", async () => {
    const ctx = await setUpAdmin();
    await record("v2026.11.10", ["a"], undefined, "2026-11-10T09:11:00Z");
    expect((await ctx.admin.call(`${ctx.base}/releases`)).data.releases).toHaveLength(1);
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    for (const cookie of [await appoint(alice.id, "alice"), await appoint(bob.id, "bob", "admin")]) {
      const res = await request(`${GOOGLE}/releases`, cookie);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { releases: unknown[] }).releases).toHaveLength(1);
    }
    expect((await request(`${GOOGLE}/releases`)).status).not.toBe(200);
  });
});
