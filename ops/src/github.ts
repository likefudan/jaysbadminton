// What the release site reads from and asks of GitHub, with the token in OPS_GITHUB_TOKEN.
import {
  canMoveTo,
  compareTags,
  type Env,
  type Job,
  type NoteItem,
  nextTag,
  parseNotes,
  progressOf,
  type Site,
  type SiteProgress,
  sites,
  sitesFromStepName,
  TAG,
} from "./logic";

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
/** main's migrations, and those listed in scripts/rollback-safe-migrations.json. */
async function migrationsOnMain(env: Env): Promise<{ names: string[]; safe: Record<string, unknown> }> {
  const [files, list] = await Promise.all([
    gh<{ name: string }[]>(env, "/contents/migrations?ref=main"),
    gh<{ content: string }>(env, "/contents/scripts/rollback-safe-migrations.json?ref=main").catch(() => null),
  ]);
  let safe: Record<string, unknown> = {};
  try {
    if (list) safe = JSON.parse(atob(list.content.replace(/\s/g, "")));
  } catch {
    safe = {};
  }
  return { names: files.map((f) => f.name).filter((n) => n.endsWith(".sql")), safe };
}

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

// Whether the Release workflow will deploy a tag: releases before per-site releases run their own
// ci.yml, which deploys every site, checks no migrations and uploads the backup unencrypted, so
// release.yml refuses them. Same test as there: that tag's ci.yml has the `sites` input.
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

// The page refreshes itself while a deploy runs; one answer serves every tab for a few seconds, which
// keeps the token far under GitHub's hourly limit.
let cached: { at: number; value: Promise<Awaited<ReturnType<typeof read>>> } | null = null;

/** Everything the page shows. */
export function state(env: Env, now = Date.now()) {
  if (!cached || now - cached.at > 15_000) {
    const value = read(env);
    cached = { at: now, value };
    value.catch(() => {
      if (cached?.value === value) cached = null;
    });
  }
  return cached.value;
}

/** Forgets the cached answer, after a release starts. */
export function forget() {
  cached = null;
}

async function read(env: Env) {
  const all = sites(env);
  const [releases, tags, healths, mainCommit, ciRuns, deployRuns, releaseRuns, onMain, restoreRuns] = await Promise.all(
    [
      gh<{ tag_name: string; published_at: string; draft: boolean }[]>(env, "/releases?per_page=30"),
      gh<{ name: string }[]>(env, "/tags?per_page=100"),
      Promise.all(all.map(health)),
      gh<{ sha: string }>(env, "/commits/main"),
      gh<{ workflow_runs: (Run & { head_sha: string })[] }>(
        env,
        "/actions/workflows/ci.yml/runs?branch=main&per_page=10",
      ),
      gh<{ workflow_runs: Run[] }>(env, "/actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page=8"),
      gh<{ workflow_runs: Run[] }>(env, "/actions/workflows/release.yml/runs?per_page=5"),
      migrationsOnMain(env).catch(() => ({ names: [] as string[], safe: {} })),
      gh<{ workflow_runs: Run[] }>(env, "/actions/workflows/restore.yml/runs?per_page=3").catch(() => ({
        workflow_runs: [] as Run[],
      })),
    ],
  );
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
          const { jobs } = await gh<{ jobs: Job[] }>(env, `/actions/runs/${run.id}/jobs?per_page=50`).catch(() => ({
            jobs: [] as Job[],
          }));
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
            jobs,
          };
        }),
    ),
    // Which versions each site can move to without restoring a backup first.
    ...shown.map(async (v) => {
      // When GitHub does not answer, let it through: release.yml checks again and refuses old ones.
      single[v.tag] = await perSite(env, v.tag).catch(() => true);
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
  // As the Release workflow judges it: the newest finished CI run of main's latest commit (a run
  // started again by hand counts too).
  const mainRuns = ciRuns.workflow_runs.filter((r) => r.head_sha === mainCommit.sha);
  const finished = mainRuns.find((r) => r.status === "completed" && r.conclusion);
  const mainCi = finished ? finished.conclusion! : mainRuns.length ? "running" : "none";

  // A Release run that stopped before deploying anything (a refused version, main not green) shows too.
  const refused = releaseRuns.workflow_runs
    .filter((r) => r.status === "completed" && r.conclusion === "failure")
    .map((r) => ({ tag: "", at: r.created_at, url: r.html_url, running: false, ok: false, sites: [] }));
  const runningRestore = restoreRuns.workflow_runs.find((r) => r.status !== "completed");
  const runningRelease = releaseRuns.workflow_runs.some((r) => r.status !== "completed") || !!runningRestore;
  const recent = [...deploys.map(({ jobs: _, ...d }) => d), ...refused]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  // The release under way, if any: each chosen site's step (the sites come from a step's name, see
  // the plan job in ci.yml and the Release workflow). Before its CI run starts, the Release run itself.
  const ids = all.map((s) => s.id);
  const chosenIn = (jobs: Job[]) =>
    jobs
      .flatMap((j) => j.steps ?? [])
      .reduce<string[] | null>((found, st) => found ?? sitesFromStepName(st.name, ids), null);
  let progress: {
    tag: string;
    url: string;
    at: string;
    restoring?: boolean;
    sites: Record<string, SiteProgress>;
  } | null = null;
  const live = deploys.find((d) => d.running);
  if (live) {
    // A tag from before the sites were put in a step name: the sites that already have a job.
    const chosen = chosenIn(live.jobs) ?? live.sites.map((s) => s.id);
    progress = { tag: live.tag, url: live.url, at: live.at, sites: progressOf(live.jobs, chosen) };
  } else {
    // A restore first puts the site's database back, then starts Release.
    const run = runningRestore ?? releaseRuns.workflow_runs.find((r) => r.status !== "completed");
    if (run) {
      const { jobs } = await gh<{ jobs: Job[] }>(env, `/actions/runs/${run.id}/jobs`).catch(() => ({
        jobs: [] as Job[],
      }));
      const chosen = chosenIn(jobs) ?? [];
      progress = {
        tag: "",
        url: run.html_url,
        at: run.created_at,
        restoring: run === runningRestore,
        sites: Object.fromEntries(
          chosen.map((id) => [id, { done: 0, label: run === runningRestore ? "恢复中" : "准备中", failed: false }]),
        ),
      };
    }
  }

  return {
    sites: all.map((s, i) => {
      const h = healths[i] ?? { ok: false, version: null };
      const current = currents[i] ?? null;
      return {
        ...s,
        ok: h.ok,
        version: h.version,
        behind: current ? versions.filter((v) => compareTags(v.tag, current) > 0).length : null,
        movable: shown
          .filter((v) => single[v.tag] && canMoveTo(current, newest, v.tag, onMain.names, onMain.safe))
          .map((v) => v.tag),
      };
    }),
    versions: shown.map((v) => ({ ...v, migration: newest[v.tag] ?? null, perSite: single[v.tag] ?? false })),
    latest,
    // The commit a new release would tag; the page sends it back so nothing it did not list is released.
    main: mainCommit.sha,
    next: nextTag(tags.map((t) => t.name)),
    pending,
    pendingCount,
    mainCi,
    deploys: recent,
    busy: runningRelease || deploys.some((d) => d.running),
    progress,
  };
}

/** main moved on after the page was drawn: what it listed is no longer what would be released. */
export class MainMoved extends Error {}

/**
 * Starts the Release workflow on main, to these sites: an existing version (`tag`), or a new one made
 * from main, only while main's latest commit is still `expect`, the one whose changes the page listed
 * (the workflow checks that again, in case main moves in between).
 */
export async function release(env: Env, chosen: string[], version: { tag: string } | { expect: string }) {
  if ("expect" in version) {
    const { sha } = await gh<{ sha: string }>(env, "/commits/main");
    if (sha !== version.expect) throw new MainMoved();
  }
  const everySite = chosen.length === sites(env).length;
  await gh(env, "/actions/workflows/release.yml/dispatches", {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { sites: everySite ? "all" : chosen.join(","), ...version } }),
  });
}

/**
 * 恢复备份并换版本: restore.yml backs up the site's database, puts it back to before the first
 * migration the tag lacks, then starts Release for that tag on that site.
 */
export async function restore(env: Env, site: string, tag: string) {
  await gh(env, "/actions/workflows/restore.yml/dispatches", {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { site, tag, confirm: site } }),
  });
}

/** One page of every published version, newest first, with its notes. */
export async function releaseList(env: Env, page: number) {
  const per = 20;
  const list = await gh<
    { tag_name: string; published_at: string; draft: boolean; body: string | null; html_url: string }[]
  >(env, `/releases?per_page=${per}&page=${page}`);
  const releases: { tag: string; date: string; url: string; notes: NoteItem[] }[] = list
    .filter((r) => !r.draft && TAG.test(r.tag_name))
    .map((r) => ({ tag: r.tag_name, date: r.published_at, url: r.html_url, notes: parseNotes(r.body) }));
  return { releases, more: list.length === per };
}
