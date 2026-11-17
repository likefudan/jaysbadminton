// 总入口 (Ke Li 2026-11-17): badminton.llmat.dev is the one entry to every group. Whoever signs in
// with Google sees the groups that account belongs to and their coming events, and goes on to each
// group's own site from there. The groups' sites keep running and signing people in by themselves:
// this only asks each of them (GET /api/hub/me on the site, src/worker/hub.ts) with a question signed
// by a key only this Worker holds, and a site that doesn't answer is simply not listed.
import { exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from "jose";
import { type Env, type Site, sites } from "./logic";

export interface HubKey {
  kid: string;
  publicJwk: JWK;
  privateJwk: JWK;
}

/** A new signing key; made once and kept by the Durable Object (users.ts hubKey). */
export async function newHubKey(): Promise<HubKey> {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const kid = crypto.randomUUID();
  return {
    kid,
    publicJwk: { ...(await exportJWK(pair.publicKey)), kid, alg: "ES256", use: "sig" },
    privateJwk: await exportJWK(pair.privateKey),
  };
}

export interface HubEvent {
  code: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  title: string;
  status: "open" | "closed";
  headcount: number;
  signedUp: boolean;
}
export interface HubMember {
  name: string;
  pending: boolean;
  role: string;
  unpaidCents: number;
}
/** One group this account belongs to, as its site answered. */
export interface Group {
  site: Site;
  name: string;
  member: HubMember;
  events: HubEvent[];
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const DATE = /^\d{4}-\d\d-\d\d$/;
const TIME = /^\d\d:\d\d$/;

/** What a site said, taken apart with care: only what the page shows, in the shapes it expects. */
export function readAnswer(site: Site, data: unknown): Group | null {
  const d = data as { site?: { name?: unknown }; member?: Record<string, unknown> | null; events?: unknown } | null;
  const m = d?.member;
  if (!m || typeof m !== "object" || !str(m.name)) return null;
  const events = (Array.isArray(d?.events) ? d.events : [])
    .slice(0, 30)
    .map((e: Record<string, unknown>): HubEvent | null =>
      e &&
      /^[\w-]{1,40}$/.test(str(e.code)) &&
      DATE.test(str(e.date)) &&
      TIME.test(str(e.startTime)) &&
      TIME.test(str(e.endTime))
        ? {
            code: str(e.code),
            date: str(e.date),
            startTime: str(e.startTime),
            endTime: str(e.endTime),
            location: str(e.location),
            title: str(e.title),
            status: e.status === "closed" ? "closed" : "open",
            headcount: Number.isInteger(e.headcount) ? (e.headcount as number) : 0,
            signedUp: e.signedUp === true,
          }
        : null,
    )
    .filter((e): e is HubEvent => e !== null);
  return {
    site,
    name: str(d?.site?.name, 60) || site.name,
    member: {
      name: str(m.name, 60),
      pending: m.pending === true,
      role: ["owner", "admin", "organizer"].includes(str(m.role)) ? str(m.role) : "member",
      unpaidCents: Number.isInteger(m.unpaidCents) && (m.unpaidCents as number) > 0 ? (m.unpaidCents as number) : 0,
    },
    events,
  };
}

/** The sites the 总入口 asks: every production site, and the test site for those who work on them. */
export function hubSites(env: Env, staff: boolean): Site[] {
  const all = sites(env);
  if (staff && env.STAGING_DOMAIN)
    all.push({ id: "staging", name: "测试站", domain: env.STAGING_DOMAIN, color: "#8a63d2" });
  return all;
}

/**
 * The groups this Google account belongs to, in the sites' order. Each site is asked at once and
 * given a few seconds; one that is slow, down or not taking part yet is left out.
 */
export async function groupsOf(env: Env, key: HubKey, email: string, staff: boolean): Promise<Group[]> {
  const signer = await importJWK(key.privateJwk, "ES256");
  const answers = await Promise.all(
    hubSites(env, staff).map(async (site) => {
      try {
        const origin = `https://${site.domain}`;
        const token = await new SignJWT({ email })
          .setProtectedHeader({ alg: "ES256", kid: key.kid })
          .setIssuer(env.OPS_ORIGIN)
          .setAudience(origin)
          .setIssuedAt()
          .setExpirationTime("2m")
          .sign(signer);
        const res = await fetch(`${origin}/api/hub/me`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) {
          await res.body?.cancel();
          return null;
        }
        return readAnswer(site, await res.json());
      } catch {
        return null;
      }
    }),
  );
  return answers.filter((g): g is Group => g !== null);
}
