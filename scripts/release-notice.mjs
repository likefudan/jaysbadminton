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

const wrangler = (...args) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", ...args], { encoding: "utf8" });

// Since the last release that reached someone, so a release skipped for not being the newest (the
// next one was tagged before it finished deploying) or never delivered still has its changes told;
// otherwise since the previous tag. A tag already recorded is left as it is (INSERT OR IGNORE).
let previous = "";
try {
  const [{ results }] = JSON.parse(
    wrangler("--json", "--command", "SELECT tag FROM release_notices WHERE delivered != '[]' ORDER BY created_at DESC LIMIT 1"),
  );
  const last = results[0]?.tag;
  if (last) {
    git("merge-base", "--is-ancestor", last, tag);
    previous = last;
  }
} catch {
  // Never announced before, or that tag is not behind this one: fall back to the previous tag.
}
try {
  previous ||= git("describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`);
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
  console.log(wrangler("--yes", "--file", file));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// The cron sends it within 15 minutes anyway; this only makes it arrive now.
for (let attempt = 0; attempt < 3; attempt++) {
  if (attempt) await new Promise((r) => setTimeout(r, 10_000));
  try {
    const res = await fetch(`${site}/api/release-notice`, { method: "POST", signal: AbortSignal.timeout(150_000) });
    console.log(`release notice: ${res.status} ${await res.text()}`);
    if (res.ok) break;
  } catch (err) {
    console.log(`release notice: ${err.message}`);
  }
}
