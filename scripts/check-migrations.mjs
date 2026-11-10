// CI helper, before a production site is backed up, migrated and deployed: refuses to deploy code that
// is older than the site's database. Each site migrates on its own deploy, so sites can sit on
// different releases; but rolling a site back past a migration its database has already run would
// leave old code reading data it does not understand (README「回滚的限制」). In that case the
// site's database has to be restored from the backup taken before that migration first.
// A new site (no migrations table yet) passes.
// Usage: node scripts/check-migrations.mjs [--config wrangler.<id>.json]
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

/** Migrations the database has run that this code does not have. */
export function newerThanCode(applied, files) {
  return applied.filter((name) => !files.includes(name));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = readdirSync("migrations").filter((f) => f.endsWith(".sql"));
  let applied = [];
  try {
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
        "SELECT name FROM d1_migrations ORDER BY id",
        ...process.argv.slice(2),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    applied = JSON.parse(out)[0].results.map((r) => r.name);
  } catch (err) {
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    if (!/no such table: d1_migrations/.test(text)) throw err;
    console.log("No migrations have run on this database yet");
  }
  const extra = newerThanCode(applied, files);
  if (extra.length) {
    console.log(
      `::error::这个站点的数据库已经执行过这份代码里没有的迁移（${extra.join(", ")}），不能回滚到这个版本。` +
        "要用更早的版本，先用那次迁移之前的数据库备份恢复（见 README「回滚的限制」）。",
    );
    process.exit(1);
  }
  console.log(`OK: the database has run ${applied.length} migration(s), all in this code`);
}
