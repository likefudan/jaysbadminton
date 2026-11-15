// The parts of the release site that need no network: sites, version order, which versions a site may
// move to, the next version's name, and the signed cookies. Tested in test/ops.test.ts.
import sitesJson from "../../sites.json";
import type { OpsUsers } from "./users";

export interface Env {
  OPS_ORIGIN: string;
  GITHUB_REPO: string;
  MAIN_SITE_DOMAIN: string;
  /** Fine-grained GitHub token for this repository only: Actions read/write, Contents read. */
  OPS_GITHUB_TOKEN?: string;
  /** The owner's Google account (Ke Li's): every power, and the only one who approves others. */
  OPS_EMAIL?: string;
  /** The owner's name as applicants see it (「等 Ke Li 批准」). */
  OWNER_NAME: string;
  /** Everyone else: applicants, viewers and release engineers (users.ts). */
  USERS: DurableObjectNamespace<OpsUsers>;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** The developers' Telegram group (the same bot and chat as CI's notices): told of every sign-in and
   *  every release started here. Off while missing. */
  TELEGRAM_DEV_BOT_TOKEN?: string;
  TELEGRAM_DEV_CHAT_ID?: string;
  /** Signs the login and OAuth cookies; made once by CI. */
  OPS_SESSION_KEY?: string;
}

export interface Site {
  id: string;
  name: string;
  domain: string;
  color: string;
}

const COLORS: Record<string, string> = { blue: "#3d7bd9", green: "#3aa564", purple: "#9b7fa8" };
export const MAIN_SITE = "jays";

/** Every production site in release order: Jay's first, then sites.json (same ids as the Release workflow). */
export function sites(env: Pick<Env, "MAIN_SITE_DOMAIN">): Site[] {
  return [
    { id: MAIN_SITE, name: "Jay's 羽毛球", domain: env.MAIN_SITE_DOMAIN, color: "#e8664f" },
    ...(sitesJson as { id: string; name: string; domain: string; icon?: string }[]).map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      color: COLORS[s.icon ?? ""] ?? "#e8664f",
    })),
  ];
}

export const TAG = /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

/** Release tags in order: v2026.11.09 < v2026.11.09.2 < v2026.11.10. */
export function compareTags(a: string, b: string): number {
  const parts = (t: string) => [...t.slice(1).split(".").map(Number), 1].slice(0, 4);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** The tag the Release workflow gives a new release today (Pacific date; .2, .3 … later the same day). */
export function nextTag(existing: string[], now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", ".");
  let tag = `v${day}`;
  for (let n = 2; existing.includes(tag); n++) tag = `v${day}.${n}`;
  return tag;
}

/**
 * Whether a site on `current` can move to each release without restoring a backup first: a release
 * whose newest migration is older than the one the site's code already has would run on a database it
 * does not understand (README「回滚的限制」). `newest` maps each tag to its newest migration file.
 * The site's database may have run even newer ones (an earlier rollback), so CI checks again
 * (scripts/check-migrations.mjs); this only greys out the ones that are certainly refused.
 */
export function canMoveTo(
  current: string | null,
  newest: Record<string, string | undefined>,
  tag: string,
  migrations: string[] = [],
  safe: Record<string, unknown> = {},
): boolean {
  if (!current) return true;
  const have = newest[current];
  const want = newest[tag];
  if (!have || !want) return true;
  // Going back past rollback-safe migrations needs no restore: Release sets them aside.
  if (want >= have) return true;
  const between = migrations.filter((m) => m > want && m <= have);
  return between.includes(have) && between.every((m) => Object.hasOwn(safe, m));
}

/** The sites a release request names, checked against the real list; null when any is unknown. */
export function pickSites(asked: unknown, all: Site[]): string[] | null {
  if (!Array.isArray(asked) || asked.length === 0) return null;
  const ids = all.map((s) => s.id);
  if (!asked.every((a) => typeof a === "string" && ids.includes(a))) return null;
  return ids.filter((id) => asked.includes(id));
}

const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** `value` with its signature and expiry, for a cookie. `value` must not contain "~". */
export async function sign(key: string, value: string, seconds: number, now = Date.now()): Promise<string> {
  const body = `${value}~${Math.floor(now / 1000) + seconds}`;
  return `${body}~${await hmac(key, body)}`;
}

/** The value of a cookie made by sign(), or null when it is forged, altered or expired. */
export async function unsign(key: string, cookie: string | undefined, now = Date.now()): Promise<string | null> {
  const parts = cookie?.split("~");
  if (parts?.length !== 3) return null;
  const [value, exp, mac] = parts as [string, string, string];
  if (!same(mac, await hmac(key, `${value}~${exp}`))) return null;
  if (!(Number(exp) > now / 1000)) return null;
  return value;
}

export function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** A CI job as GitHub lists it, with its steps. */
export interface Job {
  name: string;
  status: string;
  conclusion: string | null;
  steps?: { name: string; status: string; conclusion: string | null }[];
}

/** The five steps every site goes through, shown as five segments. */
export const STEPS = ["测试", "备份", "迁移", "部署", "检查"] as const;

export interface SiteProgress {
  /** Steps finished, 0–5. */
  done: number;
  label: string;
  failed: boolean;
}

/** The sites a step named "Sites: jays, sbbc" (or "Check the sites: all") was asked for. */
export function sitesFromStepName(name: string, ids: string[]): string[] | null {
  const m = /^(?:Sites|Check the sites): (.*)$/.exec(name);
  if (!m) return null;
  const words = (m[1] ?? "")
    .toLowerCase()
    .split(/[\s,，、;；]+/)
    .filter(Boolean);
  if (words.length === 0 || words.includes("all")) return ids;
  return ids.filter((id) => words.includes(id));
}

/** Which of the five steps a job's current step belongs to (1 backup, 2 migrate, 3 deploy, 4 check). */
function stepOf(name: string, before: number): number {
  if (/^Back up/.test(name)) return 1;
  if (/migrations apply/.test(name)) return 2;
  if (/wrangler deploy|sync-secrets/.test(name)) return 3;
  if (/^Smoke test|^Tell the/.test(name)) return 4;
  return before;
}

const TESTS = ["check", "unit-2", "e2e", "e2e-2", "e2e-3"];
const jobOf = (id: string) => (id === MAIN_SITE ? "deploy-production" : `deploy-sites (${id})`);

/**
 * Each chosen site's progress in one release run, from its jobs: the tests every site waits for, then
 * the site's own job (Jay's goes first; the others wait for it when it is chosen too).
 */
export function progressOf(jobs: Job[], chosen: string[]): Record<string, SiteProgress> {
  const tests = jobs.filter((j) => TESTS.includes(j.name));
  const testsFailed = tests.some((j) => j.conclusion === "failure" || j.conclusion === "cancelled");
  const testsDone = tests.every((j) => j.status === "completed" && j.conclusion !== "failure");
  const out: Record<string, SiteProgress> = {};
  for (const id of chosen) {
    const job = jobs.find((j) => j.name === jobOf(id));
    if (testsFailed) {
      out[id] = { done: 0, label: "测试没通过", failed: true };
    } else if (!job || job.status === "queued" || job.status === "waiting" || job.status === "pending") {
      const jays = jobs.find((j) => j.name === "deploy-production");
      const waitJays = id !== MAIN_SITE && chosen.includes(MAIN_SITE) && jays?.status !== "completed";
      out[id] = !testsDone
        ? { done: 0, label: "测试中", failed: false }
        : waitJays
          ? { done: 1, label: "等 Jay's 先发", failed: false }
          : { done: 1, label: "排队中", failed: false };
    } else if (job.status === "completed") {
      const ok = job.conclusion === "success";
      if (ok) out[id] = { done: 5, label: "完成", failed: false };
      else if (job.conclusion === "skipped") out[id] = { done: 1, label: "没有部署", failed: true };
      else {
        let step = 1;
        for (const s of job.steps ?? []) {
          step = stepOf(s.name, step);
          if (s.conclusion === "failure") break;
        }
        out[id] = { done: step, label: `${STEPS[step]}失败`, failed: true };
      }
    } else {
      let step = 1;
      for (const s of job.steps ?? []) {
        step = stepOf(s.name, step);
        if (s.status !== "completed") break;
      }
      out[id] = { done: step, label: `${STEPS[step]}中`, failed: false };
    }
  }
  return out;
}

export interface NoteItem {
  text: string;
  /** The pull request number, when the line names one. */
  pr: number | null;
}

/**
 * A release's notes as plain lines: GitHub's generated "* title by @who in …/pull/12" lines become the
 * title and its number; other text lines stay as they are; headings and the "Full Changelog" line go.
 */
export function parseNotes(body: string | null): NoteItem[] {
  const out: NoteItem[] = [];
  for (const raw of (body ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^\*\*Full Changelog\*\*/.test(line)) continue;
    const text = line.replace(/^[*-]\s+/, "");
    const m = /^(.*?)\s+by\s+@\S+\s+in\s+https:\/\/github\.com\/\S+\/pull\/(\d+)\s*$/.exec(text);
    if (m) out.push({ text: (m[1] ?? "").trim(), pr: Number(m[2]) });
    else out.push({ text: text.replace(/\*\*/g, ""), pr: null });
  }
  return out;
}
