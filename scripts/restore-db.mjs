// Restore helper (restore.yml): puts one site's database back to the moment before the first migration
// its database ran that TAG does not have, with D1 Time Travel (the last 30 days). Run after the backup.
// Writes to $GITHUB_OUTPUT: at=<the time restored to>.
// Usage: SITE=jays TAG=v2026.11.10.6 node scripts/restore-db.mjs
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { MAIN_SITE } from "./release-plan.mjs";

/** The time to restore to: one minute before the first migration the tag lacks ran, or null if none. */
export function restorePoint(applied, tagFiles) {
  const first = applied.find((m) => !tagFiles.includes(m.name));
  if (!first) return null;
  const ran = new Date(`${first.applied_at.replace(" ", "T")}Z`);
  return { name: first.name, at: new Date(ran.getTime() - 60_000) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { SITE: site = "", TAG: tag = "", CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
  const fail = (text) => {
    console.log(`::error::${text}`);
    process.exit(1);
  };
  const configFile = site === MAIN_SITE ? "wrangler.jsonc" : `wrangler.${site}.json`;
  const config = site === MAIN_SITE ? [] : ["--config", configFile];
  const out = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--json",
      "--command",
      "SELECT name, applied_at FROM d1_migrations ORDER BY id",
      ...config,
    ],
    { encoding: "utf8" },
  );
  const applied = JSON.parse(out)[0].results;
  const tagFiles = execFileSync("git", ["ls-tree", "--name-only", tag, "migrations/"], { encoding: "utf8" })
    .split("\n")
    .map((p) => p.replace(/^migrations\//, ""));
  const point = restorePoint(applied, tagFiles);
  if (!point) fail(`${site} 的数据库没有 ${tag} 不认识的迁移，不用恢复，直接换版本就行`);
  if (Date.now() - point.at.getTime() > 29 * 24 * 3600_000)
    fail(
      `${point.name} 是 ${point.at.toISOString()} 执行的，超过了 Cloudflare 时间回溯的 30 天，只能用备份文件手动恢复（README「回滚的限制」）`,
    );
  const id = JSON.parse(readFileSync(configFile, "utf8").replace(/^\s*\/\/.*$/gm, "")).d1_databases[0].database_id;
  const at = point.at.toISOString();
  console.log(`Restoring ${site} to ${at}, one minute before ${point.name} ran`);
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${id}/time_travel/restore?timestamp=${encodeURIComponent(at)}`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) fail(`恢复没有成功：${JSON.stringify(body.errors ?? body)}`);
  console.log(JSON.stringify(body.result));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `at=${at}\n`);
}
