// The parts of the release site that need no network: sites, version order, which versions a site may
// move to, the next version's name, and the signed cookies. Tested in test/ops.test.ts.
import sitesJson from "../../sites.json";

export interface Env {
  OPS_ORIGIN: string;
  GITHUB_REPO: string;
  MAIN_SITE_DOMAIN: string;
  /** Fine-grained GitHub token for this repository only: Actions read/write, Contents read. */
  OPS_GITHUB_TOKEN?: string;
  /** The only Google account allowed in (Ke Li's). */
  OPS_EMAIL?: string;
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
export function canMoveTo(current: string | null, newest: Record<string, string | undefined>, tag: string): boolean {
  if (!current) return true;
  const have = newest[current];
  const want = newest[tag];
  if (!have || !want) return true;
  return want >= have;
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
