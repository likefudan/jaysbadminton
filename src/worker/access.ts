import type { Context } from "hono";
import { matchedRoutes } from "hono/route";
import { assertAdminToken, hasSession } from "./auth";
import { developerMember } from "./developer";
import type { Env } from "./env";
import { googleSession, memberByGoogle, requireSameOrigin } from "./googleAuth";
import { HttpError, readJson } from "./http";
import { isStaging } from "./site";
import { type Capability, type Role, can, eventManager, inboundPayee, memberRole, ownerId } from "./organizers";

/**
 * Who may call which admin endpoint (docs/design/organizers.zh.md §10.1). The middleware works out
 * who is calling, then checks the endpoint's entry in ADMIN_ACCESS before any handler runs, so
 * handlers never decide who someone is. An endpoint missing from the table is refused.
 */

/** /admin/google: the admin page reached through a Google account instead of the link. */
export const GOOGLE_ADMIN = "google";

/** /admin/developer: the test site's developer login (developer.ts). */
const DEVELOPER_ADMIN = "developer";

/** Who is calling: the Owner (link + password, or their Google account), or an admin or organizer (Google only). */
export interface Actor {
  /** Null only for the Owner before their member record exists, which the link never outlives. */
  memberId: string | null;
  role: Exclude<Role, "member">;
}

export type AdminEnv = { Bindings: Env; Variables: { actor: Actor } };
type Ctx = Context<AdminEnv>;
type Params = Record<string, string>;

interface Rule {
  /** What the caller must be able to do; null is anyone signed in to the admin pages (they filter what they return). */
  cap: Capability | null;
  /** The admin link's password login: no session yet, the handler checks the password. */
  login?: true;
  /** Narrows `event` / `payee` to the event or payment the request is about. */
  check?: (c: Ctx, actor: Actor, p: Params) => Promise<void>;
}

const forbidden = () => new HttpError(403, "forbidden", "没有权限做这个操作");
/** An id from the path or body; anything else is null (and refused), never NaN bound into D1. */
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Whether the actor runs this event: every event with `group`, otherwise the ones they manage. */
async function managesEvent(env: Env, actor: Actor, eventId: number): Promise<boolean> {
  if (can(actor.role, "group")) return true;
  const e = await env.DB.prepare("SELECT manager_id FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ manager_id: string | null }>();
  return !!e && (await eventManager(env.DB, e)) === actor.memberId;
}

const eventOf = async (env: Env, sql: string, id: number | null) =>
  id === null ? null : ((await env.DB.prepare(sql).bind(id).first<{ event_id: number }>())?.event_id ?? null);
const paymentEventId = (env: Env, pid: number | null) =>
  eventOf(env, "SELECT event_id FROM payments WHERE id = ?", pid);

async function requireEvent(env: Env, actor: Actor, eventId: number | null): Promise<void> {
  // A missing event or bill reads the same as someone else's, so ids can't be probed; with
  // `group` there is nothing to hide, and the handler reports it as it always has.
  if (can(actor.role, "group")) return;
  if (eventId === null || !(await managesEvent(env, actor, eventId))) throw forbidden();
}

/** event: the event in the path. */
const event = (param = "id"): Rule => ({
  cap: "event",
  check: (c, actor, p) => requireEvent(c.env, actor, num(p[param])),
});

/**
 * event: the event in the path, and a roster row that must belong to it, so nobody pairs their
 * own event with a row from someone else's. Checked for everyone, the Owner too. A row that is
 * gone already (a second click on 移除) is left to the handler, which changes nothing.
 */
const rosterRow = (): Rule => ({
  cap: "event",
  check: async (c, actor, p) => {
    const eventId = num(p.id);
    // The event first, so someone else's event never tells which rows are on it.
    await requireEvent(c.env, actor, eventId);
    const rowEvent = await eventOf(c.env, "SELECT event_id FROM registrations WHERE id = ?", num(p.rid));
    if (rowEvent !== null && rowEvent !== eventId) throw new HttpError(403, "forbidden", "这一行不在这场活动的名单上");
  },
});

/** event: the event a bill (`:pid`) belongs to. */
const bill = (): Rule => ({
  cap: "event",
  check: async (c, actor, p) => requireEvent(c.env, actor, await paymentEventId(c.env, num(p.pid))),
});

/** event: the event a payment record (`:rid` of /receipts) belongs to. */
const receipt = (): Rule => ({
  cap: "event",
  check: async (c, actor, p) => {
    const rid = num(p.rid);
    await requireEvent(
      c.env,
      actor,
      await eventOf(
        c.env,
        "SELECT p.event_id FROM payment_receipts r JOIN payments p ON p.id = r.payment_id WHERE r.id = ?",
        rid,
      ),
    );
    if (can(actor.role, "group")) return;
    // Taking back a Venmo payment reopens its 待确认 row: that needs `payee` for the row too, so
    // nobody moves a payment that went into someone else's account.
    const row = await c.env.DB.prepare(
      `SELECT i.id FROM payment_receipts r JOIN inbound_payments i
         ON i.id = r.inbound_id OR (r.venmo_txn_id IS NOT NULL AND i.venmo_txn_id = r.venmo_txn_id)
       WHERE r.id = ? LIMIT 1`,
    )
      .bind(rid)
      .first<{ id: number }>();
    if (row) await requirePayee(c.env, actor, row.id);
  },
});

async function requirePayee(env: Env, actor: Actor, inboundId: number | null): Promise<void> {
  if (can(actor.role, "group")) return;
  if (inboundId === null) throw forbidden();
  const i = await env.DB.prepare("SELECT payee_id FROM inbound_payments WHERE id = ?")
    .bind(inboundId)
    .first<{ payee_id: string | null }>();
  if (!i || (await inboundPayee(env.DB, i)) !== actor.memberId) throw forbidden();
}

/** payee: a payment that went into the actor's own account (`:iid`). */
const inbound = (): Rule => ({
  cap: "payee",
  check: (c, actor, p) => requirePayee(c.env, actor, num(p.iid)),
});

/** payee + event: one's own payment, onto a bill of an event one runs. */
const inboundToBill = (): Rule => ({
  cap: "payee",
  check: async (c, actor, p) => {
    if (can(actor.role, "group")) return;
    await requirePayee(c.env, actor, num(p.iid));
    const body = await readJson(c.req.raw.clone());
    await requireEvent(c.env, actor, await paymentEventId(c.env, num(body.paymentId)));
  },
});

const cap = (capability: Capability | null): Rule => ({ cap: capability });

/**
 * Only the Owner may act on the Owner or an admin (any admin, oneself included): a member link
 * signs in as that person, and disabling or revoking an admin is the Owner's alone
 * (admin-role.zh.md §3.3). Handlers check it again on the member they read, in case that member
 * was made an admin after this table let the request through.
 */
export function assertMayActOn(actor: Actor, m: { is_owner: number; role: string }): void {
  if ((m.is_owner === 1 || m.role === "admin") && !can(actor.role, "owner"))
    throw new HttpError(403, "forbidden", "只有群主可以对群主或管理员做这个操作");
}

/** group, on the member in the path (assertMayActOn). A missing member is left to the handler. */
const memberTarget = (): Rule => ({
  cap: "group",
  check: async (c, actor, p) => {
    if (can(actor.role, "owner")) return;
    const m = await c.env.DB.prepare("SELECT is_owner, role FROM members WHERE id = ?")
      .bind(p.id ?? "")
      .first<{ is_owner: number; role: string }>();
    if (m) assertMayActOn(actor, m);
  },
});

/**
 * Every admin endpoint, as `METHOD path` under /api/admin/:token. The forwarding status is still
 * the Owner's; Telegram is each person's own (`self`).
 */
export const ADMIN_ACCESS: Record<string, Rule> = {
  // Signing in and out
  "POST /login": { cap: "owner", login: true },
  "POST /logout": cap(null),

  // owner: the Owner's own sign-in, secrets and money, wiping the database, deletes that can't be undone
  "POST /settings/password": cap("owner"),
  "POST /settings/backup-key": cap("owner"),
  "POST /settings/rotate-admin": cap("owner"),
  "GET /settings/google": cap("owner"),
  "POST /settings/google/bind": cap("owner"),
  "POST /settings/google/unbind": cap("owner"),
  "POST /settings/reset": cap("owner"),
  "POST /settings/payment": cap("owner"),
  "POST /events/:id/delete": cap("owner"),
  "POST /inbound/:iid/purge": cap("owner"),
  "POST /inbound/trash/clear": cap("owner"),
  "POST /members/:id/delete": cap("owner"),
  // Turning Sheets on makes a new export key: a secret, like the script GET /sheets shows the Owner
  "POST /sheets/enable": cap("owner"),
  "POST /sheets/disable": cap("owner"),
  "GET /payment-diagnostics": cap("owner"),
  "POST /payment-diagnostics": cap("owner"),

  // data: reading the group's data out, nothing changed (GET /sheets leaves out the script without `owner`)
  "GET /export/:file": cap("data"),
  "GET /sheets": cap("data"),
  "GET /email-status": cap("data"),

  // group: running the group
  "POST /members/:id/approve": memberTarget(),
  "POST /members/:id/approval-email": memberTarget(),
  "POST /members/:id/reject": memberTarget(),
  "POST /members/:id/note": cap("group"),
  "GET /members/:id/link": memberTarget(),
  "POST /members/:id/regenerate": memberTarget(),
  "POST /members/:id/deactivate": memberTarget(),
  "POST /members/:id/reactivate": memberTarget(),
  "GET /settings": cap("group"),
  "POST /settings": cap("group"),
  "POST /locations/remove": cap("group"),
  "POST /members/:id/appoint": memberTarget(),
  "POST /members/:id/appoint-admin": cap("owner"),
  "POST /members/:id/demote-admin": cap("owner"),
  "GET /members/:id/revoke": memberTarget(),
  "POST /members/:id/revoke": memberTarget(),
  "POST /events/:id/transfer": cap("group"),

  // members.read: the member and pending pages (they carry no personal links)
  "GET /members": cap("members.read"),
  "GET /members/:id/profile": cap("members.read"),

  // events.create
  "POST /events": cap("events.create"),
  "GET /events/defaults": cap("events.create"),
  "GET /places": cap("events.create"),
  "GET /places/:id": cap("events.create"),

  // event: one event (every event with `group`)
  "GET /events/:id": event(),
  "GET /events/:id/audit": event(),
  "POST /events/:id/edit": event(),
  "POST /events/:id/close-now": event(),
  "POST /events/:id/reopen": event(),
  "POST /events/:id/cancel": event(),
  "POST /events/:id/self-signup": event(),
  "POST /events/:id/self-cancel": event(),
  "POST /events/:id/roster/add": event(),
  "POST /events/:id/roster/:rid/rename": rosterRow(),
  "POST /events/:id/roster/:rid/remove": rosterRow(),
  "POST /events/:id/attendance": event(),
  "GET /events/:id/settlement": event(),
  "POST /events/:id/preview": event(),
  "POST /events/:id/finalize": event(),
  "POST /events/:id/dunning": event(),
  "POST /payments/:pid/mark-paid": bill(),
  "POST /payments/:pid/refunded": bill(),
  "POST /receipts/:rid/remove": receipt(),

  // payee: payments into one's own account (every payment with `group`)
  "POST /inbound/:iid/link": inboundToBill(),
  "POST /inbound/:iid/ignore": inbound(),
  "POST /inbound/:iid/unignore": inbound(),
  "POST /inbound/:iid/delete": inbound(),
  "POST /inbound/:iid/restore": inbound(),

  // self: one's own data. The Owner's payment settings stay behind the password (/settings/payment).
  "GET /payment-profile": cap("self"),
  "POST /payment-profile": cap("self"),
  "GET /organizer/retire": cap("self"),
  "GET /telegram": cap("self"),
  "POST /telegram/connect": cap("self"),
  "POST /telegram/test": cap("self"),
  "POST /telegram/disconnect": cap("self"),
  "POST /organizer/retire": cap("self"),

  // Anyone signed in; the handler returns only what they may see
  "GET /events": cap(null),
  "GET /inbound": cap(null),
};

/** The admin routes' paths start with this (the mount point, then the token). */
const TOKEN_PREFIX = "/:token";

/**
 * The endpoint a request will reach, as `METHOD path` relative to /:token, with its path params.
 * Hono runs the matching routes in the order they were registered and the first handler answers
 * (handlers never pass on), so that is the endpoint: GET /events/defaults, not GET /events/:id.
 */
function endpoint(c: Ctx): { key: string; params: Params } | null {
  const routes = matchedRoutes(c);
  const index = routes.findIndex((r) => r.method !== "ALL" && r.path.includes(`${TOKEN_PREFIX}/`));
  const route = routes[index];
  if (!route) return null;
  // That route's params, decoded by Hono itself.
  const own = c.req.routeIndex;
  c.req.routeIndex = index;
  const params = c.req.param() as Params;
  c.req.routeIndex = own;
  const pattern = route.path.slice(route.path.indexOf(TOKEN_PREFIX) + TOKEN_PREFIX.length);
  return { key: `${route.method} ${pattern}`, params };
}

/** Works out the actor from the link + password session or the Google session; 401 otherwise. */
async function resolveActor(c: Ctx, rule: Rule | undefined): Promise<Actor> {
  if (c.req.param("token") === DEVELOPER_ADMIN) {
    // The test site's 开发者登录 (developer.ts): it opens the admin pages as the Owner would.
    if (!isStaging(c.env)) throw new HttpError(404, "not_found", "找不到这个地址");
    if (c.req.method !== "GET") requireSameOrigin(c);
    if (!(await developerMember(c))) throw new HttpError(401, "developer_login_required", "请先使用开发者登录");
    return { memberId: await ownerId(c.env.DB), role: "owner" };
  }
  if (c.req.param("token") === GOOGLE_ADMIN) {
    // The Google cookie is SameSite=Lax (the admin one is Strict), so writes must come from this site.
    if (c.req.method !== "GET") requireSameOrigin(c);
    const session = await googleSession(c);
    const m = session ? await memberByGoogle(c.env, session.google_sub) : null;
    // memberRole only makes an organizer or admin while the ORGANIZERS flag is on, and reads the database on
    // every request, so revoking or disabling one shuts them out at once.
    const role = m && m.status === "active" ? memberRole(c.env, m) : "member";
    if (!m || role === "member")
      throw new HttpError(401, "google_admin_required", "请用群主、管理员或组织者的 Google 账号登录");
    return { memberId: m.id, role };
  }
  await assertAdminToken(c.env, c.req.param("token") ?? "");
  if (!rule?.login && !(await hasSession(c))) throw new HttpError(401, "login_required", "请输入群主密码");
  return { memberId: await ownerId(c.env.DB), role: "owner" };
}

/** The /api/admin/:token/* middleware. */
export async function adminAccess(c: Ctx, next: () => Promise<void>): Promise<void> {
  const target = endpoint(c);
  const rule = target ? ADMIN_ACCESS[target.key] : undefined;
  const actor = await resolveActor(c, rule);
  if (!target) return next(); // nothing here: the 404 handler answers
  // Fail closed: an endpoint someone forgot to list is refused (and the registry test fails).
  if (!rule) throw forbidden();
  if (rule.cap && !can(actor.role, rule.cap)) throw forbidden();
  if (rule.check) await rule.check(c, actor, target.params);
  c.set("actor", actor);
  await next();
}
