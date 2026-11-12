// Release helper, before an existing tag is deployed to some sites (catch-up or rollback). A site's
// database may have run migrations the tag does not have; check-migrations.mjs (the tag's own) then
// refuses the deploy, and the database has to be restored first. Migrations listed in
// rollback-safe-migrations.json only add what older code never reads and can run again, so for them
// this removes their rows from d1_migrations instead: the older code deploys, and the next newer
// release runs them again. Anything else it leaves alone and stops the release with the reason.
// Usage: TAG=v2026.11.10.6 SITES="jays, sbbc" node scripts/set-aside-migrations.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { MAIN_SITE, plan } from "./release-plan.mjs";

const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Which of the database's migrations the tag lacks, split into those it may set aside and the rest. */
export function setAside(applied, tagFiles, safe) {
  const extra = applied.filter((name) => !tagFiles.includes(name));
  return {
    aside: extra.filter((name) => Object.hasOwn(safe, name) && NAME.test(name)),
    blocked: extra.filter((name) => !(Object.hasOwn(safe, name) && NAME.test(name))),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tag = process.env.TAG ?? "";
  const safe = JSON.parse(readFileSync("scripts/rollback-safe-migrations.json", "utf8"));
  const tagFiles = execFileSync("git", ["ls-tree", "--name-only", tag, "migrations/"], { encoding: "utf8" })
    .split("\n")
    .map((p) => p.replace(/^migrations\//, ""))
    .filter((n) => n.endsWith(".sql"));
  const ids = [MAIN_SITE, ...JSON.parse(readFileSync("sites.json", "utf8")).map((s) => s.id)];
  const wrangler = (args) =>
    execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let stop = false;
  for (const id of plan(process.env.SITES, ids)) {
    const config = id === MAIN_SITE ? [] : ["--config", `wrangler.${id}.json`];
    if (id !== MAIN_SITE) execFileSync("node", ["scripts/site-config.mjs", id], { stdio: "inherit" });
    let applied = [];
    try {
      const out = wrangler([
        "d1",
        "execute",
        "DB",
        "--remote",
        "--json",
        "--command",
        "SELECT name FROM d1_migrations ORDER BY id",
        ...config,
      ]);
      applied = JSON.parse(out)[0].results.map((r) => r.name);
    } catch (err) {
      if (/no such table: d1_migrations/.test(`${err.stdout ?? ""}${err.stderr ?? ""}`)) continue;
      throw err;
    }
    const { aside, blocked } = setAside(applied, tagFiles, safe);
    if (blocked.length) {
      console.log(
        `::error::${id} 的数据库执行过 ${tag} 没有的迁移（${blocked.join(", ")}），不能直接回到 ${tag}，要先恢复那次迁移之前的备份（README「回滚的限制」）`,
      );
      stop = true;
      continue;
    }
    if (!aside.length) continue;
    const list = aside.map((n) => `'${n}'`).join(", ");
    wrangler([
      "d1",
      "execute",
      "DB",
      "--remote",
      "--command",
      `DELETE FROM d1_migrations WHERE name IN (${list})`,
      ...config,
    ]);
    console.log(`${id}: set aside ${aside.join(", ")}; the next newer release runs them again`);
  }
  if (stop) process.exit(1);
}
