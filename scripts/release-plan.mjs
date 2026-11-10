// CI helper for a production release: which sites this run deploys. Jay's site is "jays", the others are
// the ids in sites.json. SITES is what was asked for when the run was started (Release → 站点, or CI →
// Run workflow on a tag): "all" or empty for every site, otherwise ids separated by commas or spaces,
// e.g. "jays, sbbc". An unknown id stops the release, so a typo never deploys nothing quietly.
// Writes to $GITHUB_OUTPUT: main=true|false (Jay's site), sites=[ids from sites.json to deploy],
// chosen=[every chosen id, "jays" included] for the release summary.
// Usage: SITES="jays sbbc" READY=true node scripts/release-plan.mjs
import { appendFileSync, readFileSync } from "node:fs";

export const MAIN_SITE = "jays";

/**
 * The ids `asked` names, in deploy order (Jay's site first, then sites.json order).
 * @param {string | undefined} asked
 * @param {string[]} ids every site id, MAIN_SITE first
 */
export function plan(asked, ids) {
  const words = (asked ?? "")
    .toLowerCase()
    .split(/[\s,，、;；]+/)
    .filter(Boolean);
  if (words.length === 0 || words.includes("all")) return ids;
  const unknown = words.filter((w) => !ids.includes(w));
  if (unknown.length) throw new Error(`没有这个站点：${unknown.join(", ")}（可选：all, ${ids.join(", ")}）`);
  return ids.filter((id) => words.includes(id));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const extra = JSON.parse(readFileSync("sites.json", "utf8")).map((s) => s.id);
  let chosen;
  try {
    chosen = plan(process.env.SITES, [MAIN_SITE, ...extra]);
  } catch (err) {
    console.log(`::error::${err.message}`);
    process.exit(1);
  }
  let sites = chosen.filter((id) => id !== MAIN_SITE);
  if (sites.length && process.env.READY !== "true") {
    console.log(`::warning::SITES_KEY or SITES_ADMIN_PASSWORD is not set: ${sites.join(", ")} not deployed`);
    sites = [];
  }
  const out = [
    `main=${chosen.includes(MAIN_SITE)}`,
    `sites=${JSON.stringify(sites)}`,
    `chosen=${JSON.stringify(chosen)}`,
  ];
  console.log(out.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${out.join("\n")}\n`);
}
