// CI helper, after a production release has deployed: records the version and the changes since
// the previous release (the merged PR titles) in the production database, then asks the Worker to
// tell the Owner and the admins in Telegram (src/worker/releaseNotice.ts). Each site is told only
// about a release newer than any it was told about before: sites can be released one by one, so a
// site catching up to an older release still hears of it, but rolling back says nothing, and each
// version is announced once, so redeploying it says nothing either.
// Usage: GITHUB_REF_NAME=v2026.10.21 node scripts/release-notice.mjs
// For an extra site from sites.json, also SITE_ORIGIN and WRANGLER_CONFIG=wrangler.<id>.json.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const site = process.env.SITE_ORIGIN ?? "https://jaysbadminton.llmat.dev";
const tag = process.env.GITHUB_REF_NAME ?? "";
if (!/^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(tag)) throw new Error(`not a release tag: ${tag}`);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const wrangler = (...args) =>
  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      ...args,
      ...(process.env.WRANGLER_CONFIG ? ["--config", process.env.WRANGLER_CONFIG] : []),
    ],
    { encoding: "utf8" },
  );

/** Release tags in order: v2026.11.09 < v2026.11.09.2 < v2026.11.10. */
const parts = (t) => [...t.slice(1).split(".").map(Number), 1].slice(0, 4);
const compare = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
{
  const [{ results }] = JSON.parse(wrangler("--json", "--command", "SELECT tag FROM release_notices"));
  const told = results.map((r) => r.tag).filter((t) => /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(t));
  const latest = told.sort(compare).at(-1);
  if (latest && compare(latest, tag) >= 0) {
    console.log(`${new URL(site).host}: already told about ${latest}, so ${tag} gets no notice`);
    process.exit(0);
  }
}

// Since the last release that reached someone, so a release skipped for not being the newest (the
// next one was tagged before it finished deploying) or never delivered still has its changes told;
// otherwise since the previous tag. A tag already recorded is left as it is (INSERT OR IGNORE).
let previous = "";
try {
  const [{ results }] = JSON.parse(
    wrangler(
      "--json",
      "--command",
      "SELECT tag FROM release_notices WHERE delivered != '[]' ORDER BY created_at DESC LIMIT 1",
    ),
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
