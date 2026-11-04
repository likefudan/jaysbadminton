import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { appointAdmin, handBackIfRevoked } from "../src/worker/appointments";
import { nextDeadlineAlarm } from "../src/worker/notify";
import { sendToMember } from "../src/worker/telegram";
import { approveMember, appoint, createTestEvent, futureDate, GOOGLE, request, setUpAdmin } from "./helpers";

const db = env.DB;
const on = { ...env, ORGANIZERS: "1" };

/** Owner Jay, admin Carol (Google), organizer Alice (Google) and member Bob. */
async function scenario() {
  const ctx = await setUpAdmin();
  const carol = await approveMember(ctx, "Carol");
  const alice = await approveMember(ctx, "Alice");
  const bob = await approveMember(ctx, "Bob");
  const admin = await appoint(carol.id, "carol", "admin");
  const org = await appoint(alice.id, "alice");
  const owner = async (path: string, body?: unknown) => {
    const res = await request(`${ctx.base}${path}`, ctx.admin.cookie, body);
    return { status: res.status, data: (await res.json()) as any };
  };
  const asAdmin = async (path: string, body?: unknown) => {
    const res = await request(`${GOOGLE}${path}`, admin, body);
    return { status: res.status, data: (await res.json()) as any };
  };
  return { ctx, carol, alice, bob, admin, org, owner, asAdmin };
}

const role = async (id: string) =>
  (await db.prepare("SELECT role, status FROM members WHERE id = ?").bind(id).first()) as {
    role: string;
    status: string;
  };

describe("an admin", () => {
  it("signs in with Google and sees every event and payment, like the Owner", async () => {
    const { ctx, asAdmin, admin, org } = await scenario();
    const theirs = await createTestEvent(ctx);
    const created = await request(`${GOOGLE}/events`, org, {
      date: futureDate(8),
      startTime: "19:00",
      endTime: "21:00",
      location: "Alice Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    });
    const mine = (await created.json()) as { id: number };
    const events = (await asAdmin("/events")).data;
    expect(events.current.map((e: { id: number }) => e.id).sort()).toEqual([theirs.id, mine.id].sort());
    expect((await asAdmin(`/events/${theirs.id}`)).status).toBe(200);
    expect(await (await request("/api/auth/session", admin)).json()).toMatchObject({ role: "admin" });
    // The pages show what the caps allow: everything but the Owner's own.
    const { caps } = (await asAdmin("/members")).data.viewer;
    expect(caps).toContain("group");
    expect(caps).toContain("data");
    expect(caps).not.toContain("owner");
  });

  it("may create an event that has already started, closed and without any notice", async () => {
    const { ctx, carol, bob, asAdmin, org } = await scenario();
    await db
      .prepare(
        "INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, 'k', 'a', ?)",
      )
      .bind("https://push.example/bob", bob.id, new Date().toISOString())
      .run();
    // Started two hours ago with the deadline at the start: fresh enough that 报名截止 would go out.
    const pacific = (ms: number) =>
      Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Los_Angeles",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(new Date(ms))
          .map((p) => [p.type, p.value]),
      );
    const start = pacific(Date.now() - 2 * 3600_000);
    const end = pacific(Date.now() - 3600_000);
    const past = {
      date: `${start.year}-${start.month}-${start.day}`,
      startTime: `${start.hour}:${start.minute}`,
      endTime: `${end.hour}:${end.minute}`,
      location: "Old Gym",
      deadlineDays: 0,
      deadlineHours: 0,
      joinSelf: true,
    };
    const res = await asAdmin("/events", past);
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("closed");
    expect(res.data.roster.map((r: { memberId: string }) => r.memberId)).toEqual([carol.id]);
    // Nobody is told about it: no 新活动 push, and no 报名截止 or 快开始了 still to come.
    expect((await db.prepare("SELECT COUNT(*) AS n FROM push_outbox").first<{ n: number }>())!.n).toBe(0);
    expect(await nextDeadlineAlarm(env, res.data.id)).toBeNull();
    // The next 新建活动 form doesn't pick up the test event's time or venue.
    expect((await asAdmin("/events/defaults")).data.location).not.toBe("Old Gym");
    // The Owner may too; an organizer still may not.
    expect((await request(`${ctx.base}/events`, ctx.admin.cookie, past)).status).toBe(200);
    const theirs = await request(`${GOOGLE}/events`, org, past);
    expect(((await theirs.json()) as any).error.message).toBe("按这个提前量算出的截止时间已经过了，请调整");
    // Nor one still under way without a deadline (报名截止时间 off): it has started all the same.
    const soon = pacific(Date.now() + 3600_000);
    const underWay = { ...past, endTime: `${soon.hour}:${soon.minute}`, noDeadline: true };
    const theirsNow = await request(`${GOOGLE}/events`, org, underWay);
    expect(((await theirsNow.json()) as any).error.message).toBe("这个活动已经开始了");
    expect((await asAdmin("/events", underWay)).data.status).toBe("closed");
    // A mistyped year is caught: at most half a year back, or as many days as 设置 says.
    const old = await asAdmin("/events", { ...past, date: `${Number(start.year) - 10}-${start.month}-${start.day}` });
    expect(old.data.error.message).toBe("已经开始的活动最多补建 183 天内的");
    expect((await asAdmin("/events", { ...past, date: futureDate(-170) })).status).toBe(200);
    expect((await asAdmin("/settings", { pastEventDays: 30 })).status).toBe(200);
    expect((await asAdmin("/settings")).data.pastEventDays).toBe(30);
    const month = await asAdmin("/events", { ...past, date: futureDate(-40) });
    expect(month.data.error.message).toBe("已经开始的活动最多补建 30 天内的");
    expect((await asAdmin("/settings", { pastEventDays: 0 })).status).toBe(400);
    // Still to start with its deadline already gone is refused, for everyone.
    const late = await asAdmin("/events", { ...past, date: futureDate(1), deadlineDays: 3 });
    expect(late.data.error.message).toBe("按这个提前量算出的截止时间已经过了，请调整");
  });

  it("creates events they run and are paid for", async () => {
    const { carol, asAdmin } = await scenario();
    const res = await asAdmin("/events", {
      date: futureDate(9),
      startTime: "19:00",
      endTime: "21:00",
      location: "Carol Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    });
    expect(res.status).toBe(200);
    expect(await db.prepare("SELECT manager_id, payee_id FROM events WHERE id = ?").bind(res.data.id).first()).toEqual({
      manager_id: carol.id,
      payee_id: carol.id,
    });
  });

  it("manages members and organizers, but never the Owner or an admin", async () => {
    const { carol, alice, bob, asAdmin, owner } = await scenario();
    // A plain member and an organizer: link, note, disable and enable again.
    expect((await asAdmin(`/members/${bob.id}/link`)).status).toBe(200);
    expect((await asAdmin(`/members/${bob.id}/note`, { note: "左手" })).status).toBe(200);
    // Alice signs in with Google, so she has no 专属链接 to show or make (Ke Li 2026-11-04).
    expect((await asAdmin(`/members/${alice.id}/link`)).status).toBe(400);
    expect((await asAdmin(`/members/${alice.id}/regenerate`, {})).status).toBe(400);
    expect((await asAdmin(`/members/${bob.id}/deactivate`, {})).status).toBe(200);
    expect((await asAdmin(`/members/${bob.id}/reactivate`, {})).status).toBe(200);
    // Deleting a member can't be undone: the Owner's alone.
    expect((await asAdmin(`/members/${bob.id}/delete`, {})).status).toBe(403);
    // The Owner (M001), and any admin, themselves included: only the note.
    for (const id of ["M001", carol.id]) {
      for (const [path, body] of [
        [`/members/${id}/link`, undefined],
        [`/members/${id}/regenerate`, {}],
        [`/members/${id}/deactivate`, {}],
        [`/members/${id}/reactivate`, {}],
        [`/members/${id}/appoint`, {}],
        [`/members/${id}/revoke`, undefined],
        [`/members/${id}/revoke`, {}],
      ] as const)
        expect((await asAdmin(path, body)).status, `${path} ${id}`).toBe(403);
      expect((await asAdmin(`/members/${id}/note`, { note: "n" })).status).toBe(200);
    }
    expect(await role(carol.id)).toEqual({ role: "admin", status: "active" });
    // Appointing and revoking organizers is theirs.
    expect((await asAdmin(`/members/${alice.id}/revoke`, {})).status).toBe(200);
    expect((await role(alice.id)).role).toBe("member");
    expect((await asAdmin(`/members/${alice.id}/appoint`, {})).status).toBe(200);
    expect((await role(alice.id)).role).toBe("organizer");
    // 设为组织者 never turns an admin into an organizer, even for the Owner.
    const refused = await owner(`/members/${carol.id}/appoint`, {});
    expect(refused.status).toBe(400);
    expect(refused.data.error.message).toContain("已经是管理员");
    expect((await role(carol.id)).role).toBe("admin");
  });

  it("leaves another admin to the Owner", async () => {
    const { ctx, asAdmin, owner } = await scenario();
    const dave = await approveMember(ctx, "Dave");
    await appoint(dave.id, "dave", "admin");
    for (const [path, body] of [
      [`/members/${dave.id}/link`, undefined],
      [`/members/${dave.id}/regenerate`, {}],
      [`/members/${dave.id}/deactivate`, {}],
      [`/members/${dave.id}/revoke`, {}],
    ] as const)
      expect((await asAdmin(path, body)).status, path).toBe(403);
    expect(await role(dave.id)).toEqual({ role: "admin", status: "active" });
    // The Owner may, and the email and 操作记录 name whoever did it.
    expect((await owner(`/members/${dave.id}/revoke`, {})).status).toBe(200);
    expect((await role(dave.id)).role).toBe("member");
  });

  it("is named as the one who revoked an organizer", async () => {
    const { carol, alice, asAdmin, org } = await scenario();
    const created = await request(`${GOOGLE}/events`, org, {
      date: futureDate(8),
      startTime: "19:00",
      endTime: "21:00",
      location: "Alice Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    });
    const e = (await created.json()) as { id: number };
    expect((await asAdmin(`/members/${alice.id}/revoke`, {})).status).toBe(200);
    const row = await db
      .prepare("SELECT actor_id, detail FROM event_audit WHERE event_id = ? AND action = 'reassign'")
      .bind(e.id)
      .first<{ actor_id: string; detail: string }>();
    expect(row).toMatchObject({ actor_id: carol.id });
    expect(row!.detail).toContain("撤销 Alice 的组织者身份");
  });

  it("gets the Sheets status but never the script with the export key", async () => {
    const { owner, asAdmin, admin } = await scenario();
    expect((await owner("/sheets/enable", {})).status).toBe(200);
    expect((await asAdmin("/sheets/enable", {})).status).toBe(403);
    const mine = (await asAdmin("/sheets")).data;
    expect(mine.script).toBeNull();
    expect(mine.enabled).toBe(true);
    expect((await owner("/sheets")).data.script).toEqual(expect.any(String));
    expect((await request(`${GOOGLE}/export/members.csv`, admin)).status).toBe(200);
    expect((await asAdmin("/email-status")).status).toBe(200);
  });

  it("keeps the Owner's own powers away", async () => {
    const { asAdmin } = await scenario();
    for (const [path, body] of [
      ["/settings/reset", { confirm: "清空所有数据", password: "initial-password" }],
      ["/settings/backup-key", { password: "initial-password" }],
      ["/settings/password", { current: "initial-password", next: "another-password-1" }],
      ["/settings/rotate-admin", {}],
      ["/settings/payment", { password: "initial-password" }],
      ["/settings/google", undefined],
      ["/payment-diagnostics", undefined],
      ["/inbound/trash/clear", {}],
    ] as const)
      expect((await asAdmin(path, body)).status, path).toBe(403);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM members").first()).toEqual({ n: 4 });
    // The global settings are theirs, the Owner's own payment settings are not.
    await db.prepare("INSERT INTO settings (key, value) VALUES ('venmo_email', 'owner@venmo.test')").run();
    const settings = await asAdmin("/settings");
    expect(settings.status).toBe(200);
    expect(settings.data).not.toHaveProperty("venmoEmail");
    expect(settings.data).not.toHaveProperty("zelleAccount");
    expect(settings.data.friendCap).toEqual(expect.any(Number));
  });

  it("can be handed an event, and is revoked when the Owner disables them", async () => {
    const { ctx, carol, owner, asAdmin } = await scenario();
    const e = await createTestEvent(ctx);
    expect((await owner(`/events/${e.id}/transfer`, { to: carol.id })).status).toBe(200);
    expect(await db.prepare("SELECT manager_id, payee_id FROM events WHERE id = ?").bind(e.id).first()).toEqual({
      manager_id: carol.id,
      payee_id: carol.id,
    });
    // An admin hands events on too.
    expect((await asAdmin(`/events/${e.id}/transfer`, { to: "M001" })).status).toBe(200);
    expect((await owner(`/events/${e.id}/transfer`, { to: carol.id })).status).toBe(200);

    const off = await owner(`/members/${carol.id}/deactivate`, {});
    expect(off.status).toBe(200);
    expect(off.data.revoked).not.toBeNull();
    expect(await role(carol.id)).toEqual({ role: "member", status: "inactive" });
    expect(await db.prepare("SELECT manager_id, payee_id FROM events WHERE id = ?").bind(e.id).first()).toEqual({
      manager_id: "M001",
      payee_id: "M001",
    });
    expect((await asAdmin("/events")).status).toBe(401);
  });

  it("is not listed as a 历史收款人 while running their own events", async () => {
    const { carol, owner, asAdmin } = await scenario();
    const res = await asAdmin("/events", {
      date: futureDate(9),
      startTime: "19:00",
      endTime: "21:00",
      location: "Carol Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    });
    expect(res.status).toBe(200);
    const block = (await owner("/members")).data.organizers;
    expect(block.former.map((f: { id: string }) => f.id)).not.toContain(carol.id);
  });

  it("answers a second 停用 of an organizer as it always has", async () => {
    const { alice, owner } = await scenario();
    expect((await owner(`/members/${alice.id}/deactivate`, {})).status).toBe(200);
    const again = await owner(`/members/${alice.id}/deactivate`, {});
    expect(again.status).toBe(400);
    expect(await role(alice.id)).toEqual({ role: "member", status: "inactive" });
  });

  it("is revoked by 恢复 if disabled by older code, and can't be deleted before", async () => {
    const { carol, owner } = await scenario();
    await db.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(carol.id).run();
    const refused = await owner(`/members/${carol.id}/delete`, {});
    expect(refused.status).toBe(400);
    expect(refused.data.error.message).toContain("还有管理员身份");
    expect((await owner(`/members/${carol.id}/reactivate`, {})).status).toBe(200);
    expect(await role(carol.id)).toEqual({ role: "member", status: "active" });
  });

  it("hands an event back if revoked while creating it", async () => {
    const { ctx, carol } = await scenario();
    const e = await createTestEvent(ctx);
    await db.prepare("UPDATE events SET manager_id = ?1, payee_id = ?1 WHERE id = ?2").bind(carol.id, e.id).run();
    await handBackIfRevoked(on, e.id, carol.id);
    expect((await db.prepare("SELECT manager_id FROM events WHERE id = ?").bind(e.id).first())?.manager_id).toBe(
      carol.id,
    );
    await db.prepare("UPDATE members SET role = 'member' WHERE id = ?").bind(carol.id).run();
    await handBackIfRevoked(on, e.id, carol.id);
    expect((await db.prepare("SELECT manager_id FROM events WHERE id = ?").bind(e.id).first())?.manager_id).toBe(
      "M001",
    );
  });

  it("steps down with 不再当管理员", async () => {
    const { carol, asAdmin } = await scenario();
    expect((await asAdmin("/organizer/retire")).status).toBe(200);
    expect((await asAdmin("/organizer/retire", {})).status).toBe(200);
    expect((await role(carol.id)).role).toBe("member");
  });

  it("is a plain member while the flag is off", async () => {
    const { admin } = await scenario();
    expect((await request(`${GOOGLE}/events`, admin, undefined, "0")).status).toBe(401);
  });

  it("gets Telegram in their own chat", async () => {
    const { carol } = await scenario();
    await db.prepare("INSERT INTO telegram_bindings (member_id, chat_id) VALUES (?, '77')").bind(carol.id).run();
    const sent: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      sent.push(String(init?.body ?? ""));
      return Response.json({ ok: true, result: { message_id: 1 } });
    }) as typeof fetch;
    try {
      expect(await sendToMember(on, carol.id, () => "hi")).toBe(true);
    } finally {
      globalThis.fetch = real;
    }
    expect(sent.some((b) => b.includes('"chat_id":"77"'))).toBe(true);
  });
});

describe("appointing admins", () => {
  const mailEnv = { ...env, ORGANIZERS: "1", RESEND_API_KEY: "re_test", EMAIL_FROM: "Jay <jay@example.com>" };
  const emails: { subject: string; text: string }[] = [];
  const withMail = async <T>(f: () => Promise<T>) => {
    emails.length = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      if (String(input) === "https://api.resend.com/emails") emails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "email-1" });
    }) as typeof fetch;
    try {
      return await f();
    } finally {
      globalThis.fetch = real;
    }
  };

  it("is the Owner's alone, and needs Google", async () => {
    const { ctx, bob, alice, owner, asAdmin } = await scenario();
    expect((await asAdmin(`/members/${bob.id}/appoint-admin`, {})).status).toBe(403);
    expect(
      (await request(`${GOOGLE}/members/${bob.id}/appoint-admin`, await appoint(alice.id, "alice"), {})).status,
    ).toBe(403);
    // Bob has no Google account.
    const refused = await owner(`/members/${bob.id}/appoint-admin`, {});
    expect(refused.status).toBe(400);
    expect(refused.data.error.message).toContain("Google");
    // With the flag off, nobody is appointed.
    const dave = await approveMember(ctx, "Dave");
    await db.prepare("UPDATE members SET google_sub = 'google-dave' WHERE id = ?").bind(dave.id).run();
    expect((await request(`${ctx.base}/members/${dave.id}/appoint-admin`, ctx.admin.cookie, {}, "0")).status).toBe(403);
    expect((await owner(`/members/${dave.id}/appoint-admin`, {})).status).toBe(200);
    expect(await role(dave.id)).toEqual({ role: "admin", status: "active" });
    expect((await owner(`/members/${dave.id}/appoint-admin`, {})).status).toBe(400);
    expect((await owner("/members")).data.active.find((m: { id: string }) => m.id === dave.id)).toMatchObject({
      isAdmin: true,
      isOrganizer: false,
    });
  });

  it("promotes an organizer, who keeps their events, and demotes them again", async () => {
    const { alice, org, owner } = await scenario();
    const created = await request(`${GOOGLE}/events`, org, {
      date: futureDate(8),
      startTime: "19:00",
      endTime: "21:00",
      location: "Alice Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    });
    const e = (await created.json()) as { id: number };
    const up = await withMail(() => appointAdmin(mailEnv, alice.id));
    expect(up).toMatchObject({ from: "organizer", emailStatus: "sent" });
    expect(emails[0]!.subject).toBe("你已成为羽毛球群的管理员");
    expect(emails[0]!.text).toContain("保留不变");
    expect(await role(alice.id)).toEqual({ role: "admin", status: "active" });
    expect(await db.prepare("SELECT manager_id, payee_id FROM events WHERE id = ?").bind(e.id).first()).toEqual({
      manager_id: alice.id,
      payee_id: alice.id,
    });
    // Now she sees the whole group.
    expect((await request(`${GOOGLE}/members/M001/profile`, org)).status).toBe(200);
    expect((await request(`${GOOGLE}/settings`, org)).status).toBe(200);

    const down = await owner(`/members/${alice.id}/demote-admin`, {});
    expect(down.status).toBe(200);
    expect(await role(alice.id)).toEqual({ role: "organizer", status: "active" });
    expect((await request(`${GOOGLE}/settings`, org)).status).toBe(403);
    expect(await db.prepare("SELECT manager_id FROM events WHERE id = ?").bind(e.id).first()).toEqual({
      manager_id: alice.id,
    });
    expect((await owner(`/members/${alice.id}/demote-admin`, {})).status).toBe(400);
  });

  it("revokes an admin like an organizer: their events go back to the Owner", async () => {
    const { carol, owner, asAdmin } = await scenario();
    const res = await asAdmin("/events", {
      date: futureDate(9),
      startTime: "19:00",
      endTime: "21:00",
      location: "Carol Gym",
      deadlineDays: 1,
      deadlineHours: 0,
    });
    const preview = await owner(`/members/${carol.id}/revoke`);
    expect(preview.data.events.map((e: { outcome: string }) => e.outcome)).toEqual(["to_owner"]);
    expect((await owner(`/members/${carol.id}/revoke`, {})).status).toBe(200);
    expect(await role(carol.id)).toEqual({ role: "member", status: "active" });
    expect(await db.prepare("SELECT manager_id, payee_id FROM events WHERE id = ?").bind(res.data.id).first()).toEqual({
      manager_id: "M001",
      payee_id: "M001",
    });
  });
});
