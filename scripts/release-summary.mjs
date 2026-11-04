// CI helper: after a release, one message to the developers' Telegram group with every production
// site's result side by side (Jay's site and each site in sites.json are all production sites).
// Reads this run's jobs from the GitHub API, so a site whose job failed, was skipped or never started
// shows as such. Prints the message; the workflow passes it to scripts/notify-dev.sh.
// Usage: node scripts/release-summary.mjs   — needs GH_TOKEN (actions: read) and the usual GITHUB_* vars.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The message for these jobs. `sites` lists every production site in deploy order, each with the
 * name of the CI job that deploys it.
 * @param {{ tag: string, releaseUrl: string, runUrl: string,
 *   sites: { host: string, job: string }[], jobs: { name: string, conclusion: string | null }[] }} p
 */
export function summary({ tag, releaseUrl, runUrl, sites, jobs }) {
  const result = (job) => jobs.find((j) => j.name === job)?.conclusion ?? null;
  const lines = sites.map(({ host, job }) => {
    const r = result(job);
    if (r === "success") return `✓ ${host}`;
    if (r === "failure" || r === "cancelled" || r === "timed_out") return `✗ ${host}（失败）`;
    return `– ${host}（未部署）`;
  });
  const ok = sites.filter(({ job }) => result(job) === "success").length;
  const head =
    ok === sites.length
      ? `🚀 ${tag} 已发布到全部 ${sites.length} 个正式站`
      : `⚠️ ${tag} 发布未全部成功（${ok}/${sites.length} 个正式站）`;
  const tail = ok === sites.length ? `更新内容：${releaseUrl}` : `查看原因：${runUrl}\n更新内容：${releaseUrl}`;
  return `${head}\n${lines.join("\n")}\n\n${tail}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt = "1" } = process.env;
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const tag = process.env.GITHUB_REF_NAME;
  const out = execFileSync(
    "gh",
    ["api", "--paginate", `repos/${repo}/actions/runs/${run}/attempts/${attempt}/jobs`, "--jq", ".jobs[]"],
    { encoding: "utf8" },
  );
  const jobs = out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  // wrangler.jsonc only has whole-line comments.
  const base = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const sites = [
    { host: new URL(base.vars.SITE_ORIGIN).host, job: "deploy-production" },
    ...JSON.parse(readFileSync("sites.json", "utf8")).map((s) => ({ host: s.domain, job: `deploy-sites (${s.id})` })),
  ];
  console.log(
    summary({
      tag,
      releaseUrl: `${server}/${repo}/releases/tag/${tag}`,
      runUrl: `${server}/${repo}/actions/runs/${run}`,
      sites,
      jobs,
    }),
  );
}
