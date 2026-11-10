// What the release site reads from and asks of GitHub, with the token in OPS_GITHUB_TOKEN.
import { canMoveTo, compareTags, type Env, nextTag, type Site, sites, TAG } from "./logic";

async function gh<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.OPS_GITHUB_TOKEN}`,
      "User-Agent": "jaysbadminton-ops",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub ${path.split("?")[0]}: ${res.status}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

// Each tag's newest migration never changes, so it is looked up once per Worker instance.
const newestMigration = new Map<string, string>();
async function newestAt(env: Env, tag: string): Promise<string | undefined> {
  if (!newestMigration.has(tag)) {
    const files = await gh<{ name: string }[]>(env, `/contents/migrations?ref=${encodeURIComponent(tag)}`);
    const newest = files
      .map((f) => f.name)
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .at(-1);
    if (newest) newestMigration.set(tag, newest);
  }
  return newestMigration.get(tag);
}

// Whether a tag can go to some sites only: releases before per-site releases run their own ci.yml,
// which deploys every site. Same test as release.yml: that tag's ci.yml has the `sites` input.
const perSiteTags = new Map<string, boolean>();
async function perSite(env: Env, tag: string): Promise<boolean> {
  if (!perSiteTags.has(tag)) {
    const file = await gh<{ content: string }>(
      env,
      `/contents/.github/workflows/ci.yml?ref=${encodeURIComponent(tag)}`,
    );
    perSiteTags.set(tag, /^ {6}sites:$/m.test(atob(file.content.replace(/\s/g, ""))));
  }
  return perSiteTags.get(tag)!;
}

/** The version a site runs, from its /api/health (sites deployed before per-site releases say none). */
async function health(site: Site): Promise<{ ok: boolean; version: string | null }> {
  try {
    const res = await fetch(`https://${site.domain}/api/health`, { signal: AbortSignal.timeout(6_000) });
    const body = (await res.json()) as { ok?: boolean; version?: string };
    return { ok: res.ok && body.ok === true, version: typeof body.version === "string" ? body.version : null };
  } catch {
    return { ok: false, version: null };
  }
}

interface Run {
  id: number;
  head_branch: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

/** Everything the page shows. */
export async function state(env: Env) {
  const all = sites(env);
  const [releases, tags, healths, mainCommit, ciRuns, deployRuns, releaseRuns] = await Promise.all([
    gh<{ tag_name: string; published_at: string; draft: boolean }[]>(env, "/releases?per_page=30"),
    gh<{ name: string }[]>(env, "/tags?per_page=50"),
    Promise.all(all.map(health)),
    gh<{ sha: string }>(env, "/commits/main"),
    gh<{ workflow_runs: (Run & { head_sha: string })[] }>(
      env,
      "/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=5",
    ),
    gh<{ workflow_runs: Run[] }>(env, "/actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page=8"),
    gh<{ workflow_runs: Run[] }>(env, "/actions/workflows/release.yml/runs?per_page=5"),
  ]);
  const versions = releases
    .filter((r) => !r.draft && TAG.test(r.tag_name))
    .map((r) => ({ tag: r.tag_name, date: r.published_at }))
    .sort((a, b) => compareTags(b.tag, a.tag));
  const latest = versions[0]?.tag ?? null;

  const shown = versions.slice(0, 12);
  const currents = healths.map((h) => (h.version && TAG.test(h.version) ? h.version : null));
  const single: Record<string, boolean> = {};
  const newest: Record<string, string | undefined> = {};
  const [cmp, deploys] = await Promise.all([
    // What main has that the newest release does not.
    latest
      ? gh<{ ahead_by: number; commits: { commit: { message: string } }[] }>(
          env,
          `/compare/${encodeURIComponent(latest)}...main`,
        )
      : null,
    // Which sites each recent hand-started CI run on a release tag deployed (deploy-production = Jay's).
    Promise.all(
      deployRuns.workflow_runs
        .filter((run) => TAG.test(run.head_branch))
        .slice(0, 6)
        .map(async (run) => {
          const { jobs } = await gh<{ jobs: { name: string; conclusion: string | null; status: string }[] }>(
            env,
            `/actions/runs/${run.id}/jobs?per_page=50`,
          );
          const siteJobs = jobs
            .map((j) => {
              const id =
                j.name === "deploy-production" ? "jays" : (/^deploy-sites \((.+)\)$/.exec(j.name)?.[1] ?? null);
              return id && j.conclusion !== "skipped" ? { id, status: j.status, conclusion: j.conclusion } : null;
            })
            .filter((j) => j !== null);
          return {
            tag: run.head_branch,
            at: run.created_at,
            url: run.html_url,
            running: run.status !== "completed",
            ok: run.conclusion === "success",
            sites: siteJobs,
          };
        }),
    ),
    // Which versions each site can move to without restoring a backup first.
    ...shown.map(async (v) => {
      single[v.tag] = await perSite(env, v.tag).catch(() => false);
    }),
    ...[...new Set([...shown.map((v) => v.tag), ...currents.filter((v) => v !== null)])].map(async (tag) => {
      newest[tag] = await newestAt(env, tag).catch(() => undefined);
    }),
  ]);
  const pendingCount = cmp?.ahead_by ?? 0;
  const pending = (cmp?.commits ?? [])
    .map((c) => (c.commit.message.split("\n")[0] ?? "").replace(/\s*\(#\d+\)$/, ""))
    .reverse()
    .slice(0, 12);
  const mainRun = ciRuns.workflow_runs.find((r) => r.head_sha === mainCommit.sha);
  const mainCi = !mainRun ? "none" : mainRun.status !== "completed" ? "running" : (mainRun.conclusion ?? "none");

  // A Release run that stopped before deploying anything (a refused version, main not green) shows too.
  const refused = releaseRuns.workflow_runs
    .filter((r) => r.status === "completed" && r.conclusion === "failure")
    .map((r) => ({ tag: "", at: r.created_at, url: r.html_url, running: false, ok: false, sites: [] }));
  const runningRelease = releaseRuns.workflow_runs.some((r) => r.status !== "completed");
  const recent = [...deploys, ...refused].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  return {
    sites: all.map((s, i) => {
      const h = healths[i] ?? { ok: false, version: null };
      const current = currents[i] ?? null;
      return {
        ...s,
        ok: h.ok,
        version: h.version,
        behind: current ? versions.filter((v) => compareTags(v.tag, current) > 0).length : null,
        movable: shown.filter((v) => single[v.tag] && canMoveTo(current, newest, v.tag)).map((v) => v.tag),
      };
    }),
    versions: shown.map((v) => ({ ...v, migration: newest[v.tag] ?? null, perSite: single[v.tag] ?? false })),
    latest,
    next: nextTag(tags.map((t) => t.name)),
    pending,
    pendingCount,
    mainCi,
    deploys: recent,
    busy: runningRelease || deploys.some((d) => d.running),
  };
}

/** Starts the Release workflow on main: a new version (no tag) or an existing one, to these sites. */
export async function release(env: Env, chosen: string[], tag: string | null) {
  const everySite = chosen.length === sites(env).length;
  await gh(env, "/actions/workflows/release.yml/dispatches", {
    method: "POST",
    body: JSON.stringify({
      ref: "main",
      inputs: { sites: everySite ? "all" : chosen.join(","), ...(tag ? { tag } : {}) },
    }),
  });
}
