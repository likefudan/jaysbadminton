import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("skeleton", () => {
  it("reports health with the migrated database", async () => {
    const res = await exports.default.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, members: 0 });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns an empty home page payload", async () => {
    const res = await exports.default.fetch("https://example.com/api/public/home");
    expect(await res.json()).toEqual({ openEvents: [], pastEvents: [], leaderboard: [] });
  });

  it("answers unknown API paths with a Chinese error", async () => {
    const res = await exports.default.fetch("https://example.com/api/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("找不到这个地址");
  });
});
