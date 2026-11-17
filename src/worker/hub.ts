import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { toPacific } from "../shared/time";
import type { Env } from "./env";
import { HttpError } from "./http";
import type { MemberRow } from "./members";
import { memberRole } from "./organizers";
import { siteTitle } from "./site";

/**
 * What the 总入口 (Ke Li 2026-11-17: one entry, later one app, for every group) may ask a group's
 * site: whether a Google account is one of its members, and that member's coming events. The 总入口
 * signs each question (a short-lived token for this site only, naming the account it has just seen
 * sign in with Google) with a key only it holds; this site checks it against the 总入口's public
 * keys. Nothing here changes how the site itself works or signs people in, and it is off (404)
 * until HUB_ORIGIN is set.
 */

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function hubKeys(origin: string) {
  let keys = keySets.get(origin);
  if (!keys) {
    keys = createRemoteJWKSet(new URL("/.well-known/jwks.json", origin));
    keySets.set(origin, keys);
  }
  return keys;
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
  /** On the list themselves, or with friends under them. */
  signedUp: boolean;
}

export interface HubAnswer {
  site: { name: string };
  /** Null when the account is nobody here: the 总入口 doesn't list this group for them. */
  member: { name: string; pending: boolean; role: string; unpaidCents: number } | null;
  events: HubEvent[];
}

/** The account's email from a question the 总入口 signed for this site, or a 401. */
async function asker(env: Env, authorization: string | undefined): Promise<string> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  const refused = new HttpError(401, "hub_refused", "总入口的请求无效");
  if (!token) throw refused;
  try {
    const hub = new URL(env.HUB_ORIGIN!).origin;
    const { payload } = await jwtVerify(token, hubKeys(hub), {
      issuer: hub,
      audience: new URL(env.SITE_ORIGIN).origin,
      algorithms: ["ES256"],
      requiredClaims: ["exp", "iat", "email"],
      maxTokenAge: 120,
    });
    if (typeof payload.email !== "string" || !payload.email) throw refused;
    return payload.email.toLowerCase();
  } catch {
    throw refused;
  }
}

export async function hubAnswer(env: Env, email: string): Promise<HubAnswer> {
  const site = { name: await siteTitle(env) };
  const m = await env.DB.prepare(
    `SELECT * FROM members WHERE lower(google_email) = ? AND google_sub IS NOT NULL AND deleted_at IS NULL
       AND status != 'inactive'`,
  )
    .bind(email)
    .first<MemberRow>();
  if (!m) return { site, member: null, events: [] };
  const pending = m.status === "pending";
  // Someone still waiting to be let in sees the group, not what it is doing.
  if (pending) return { site, member: { name: m.username, pending, role: "member", unpaidCents: 0 }, events: [] };
  const [events, owed] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.code, e.start_at, e.end_at, e.location, e.title, e.status,
         (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS headcount,
         EXISTS (SELECT 1 FROM registrations r WHERE r.event_id = e.id AND (r.member_id = ?1 OR r.paid_by = ?1)) AS mine
       FROM events e WHERE e.status IN ('open', 'closed') AND e.end_at > ?2
         AND (e.status = 'open' OR EXISTS
           (SELECT 1 FROM registrations r WHERE r.event_id = e.id AND (r.member_id = ?1 OR r.paid_by = ?1)))
       ORDER BY e.start_at LIMIT 30`,
    ).bind(m.id, new Date().toISOString()),
    env.DB.prepare(
      `SELECT COALESCE(SUM(p.amount_due_cents - p.amount_paid_cents), 0) AS cents FROM payments p
       JOIN events e ON e.id = p.event_id
       WHERE p.member_id = ? AND p.status != 'paid' AND e.status = 'finalized' AND p.amount_due_cents > p.amount_paid_cents`,
    ).bind(m.id),
  ]);
  type Row = {
    code: string;
    start_at: string;
    end_at: string;
    location: string;
    title: string;
    status: "open" | "closed";
    headcount: number;
    mine: number;
  };
  return {
    site,
    member: {
      name: m.username,
      pending,
      role: memberRole(env, m),
      unpaidCents: (owed!.results[0] as { cents: number } | undefined)?.cents ?? 0,
    },
    events: (events!.results as Row[]).map((e) => ({
      code: e.code,
      date: toPacific(e.start_at).date,
      startTime: toPacific(e.start_at).time,
      endTime: toPacific(e.end_at).time,
      location: e.location,
      title: e.title,
      status: e.status,
      headcount: e.headcount,
      signedUp: e.mine === 1,
    })),
  };
}

export const hubRoutes = new Hono<{ Bindings: Env }>();
hubRoutes.get("/me", async (c) => {
  if (!c.env.HUB_ORIGIN) throw new HttpError(404, "not_found", "找不到这个地址");
  const email = await asker(c.env, c.req.header("Authorization"));
  return c.json(await hubAnswer(c.env, email), 200, { "Cache-Control": "no-store" });
});
