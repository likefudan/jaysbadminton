// CI helper, after a production release has deployed: records the version and the changes since
// the previous release (the merged PR titles) in the production database, then asks the Worker to
// tell the Owner and the admins in Telegram (src/worker/releaseNotice.ts). Only the newest release
// is announced, so redeploying an older tag to roll back says nothing; each version is announced
// once, so redeploying the newest one says nothing either.
// Usage: GITHUB_REF_NAME=v2026.10.21 node scripts/release-notice.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const site = process.env.SITE_ORIGIN ?? "https://jaysbadminton.llmat.dev";
const tag = process.env.GITHUB_REF_NAME ?? "";
if (!/^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(tag)) throw new Error(`not a release tag: ${tag}`);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const newest = git("tag", "--list", "v*", "--sort=-v:refname").split("\n")[0];
if (newest !== tag) {
  console.log(`${tag} is not the newest release (${newest}): no notice`);
  process.exit(0);
}

let previous = "";
try {
  previous = git("describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`);
} catch {
  // The first release: nothing to compare with.
}
const changes = previous
  ? git("log", "--first-parent", "--format=%s", `${previous}..${tag}`)
      .split("\n")
      .map((s) => s.replace(/\s*\(#\d+\)$/, "").trim())
      .filter(Boolean)
      .reverse()
  : [];
console.log(`${tag}: ${changes.length} change(s) since ${previous || "the start"}`);

const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const dir = mkdtempSync(join(tmpdir(), "release-notice-"));
try {
  const file = join(dir, "notice.sql");
  writeFileSync(
    file,
    `INSERT OR IGNORE INTO release_notices (tag, changes, created_at) VALUES (${quote(tag)}, ${quote(
      JSON.stringify(changes),
    )}, ${quote(new Date().toISOString())});\n`,
  );
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--yes", "--file", file], { stdio: "inherit" });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// The cron sends it within 15 minutes anyway; this only makes it arrive now.
for (let attempt = 0; attempt < 3; attempt++) {
  if (attempt) await new Promise((r) => setTimeout(r, 10_000));
  try {
    const res = await fetch(`${site}/api/release-notice`, { method: "POST", signal: AbortSignal.timeout(90_000) });
    console.log(`release notice: ${res.status} ${await res.text()}`);
    if (res.ok) break;
  } catch (err) {
    console.log(`release notice: ${err.message}`);
  }
}
