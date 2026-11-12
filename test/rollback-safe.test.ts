import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import safe from "../scripts/rollback-safe-migrations.json";

/**
 * Migrations in scripts/rollback-safe-migrations.json are set aside when a site goes back to an older
 * release and run again on the next newer one, so each must only add things and be able to run twice.
 */
describe("rollback-safe migrations", () => {
  const listed = Object.keys(safe).filter((k) => k !== "_");

  it("are real migrations that only add, with IF NOT EXISTS", () => {
    for (const name of listed) {
      const m = env.TEST_MIGRATIONS.find((x) => x.name === name);
      expect(m, name).toBeDefined();
      for (const q of m?.queries ?? []) {
        const sql = q.replace(/--.*$/gm, "").toUpperCase();
        expect(sql, `${name}: ${q}`).not.toMatch(/\b(ALTER|DROP|DELETE)\b/);
        if (/\bCREATE\b/.test(sql)) expect(sql, `${name}: ${q}`).toMatch(/IF NOT EXISTS/);
      }
    }
  });

  it("can run again without errors or doubled settings", async () => {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('leaderboard_boards', 'visits,hours')",
    ).run();
    for (const name of listed) {
      const m = env.TEST_MIGRATIONS.find((x) => x.name === name);
      for (let i = 0; i < 2; i++) await env.DB.batch((m?.queries ?? []).map((q) => env.DB.prepare(q)));
    }
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'leaderboard_boards'").first<{
      value: string;
    }>();
    expect(row?.value).toBe("visits,hours,likes");
  });
});
