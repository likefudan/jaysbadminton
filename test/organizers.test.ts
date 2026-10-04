import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  ROLE_CAPABILITIES,
  can,
  eventManager,
  eventPayee,
  memberRole,
  organizersEnabled,
  ownerId,
  payeeProfile,
} from "../src/worker/organizers";
import { deleteEvent, getEvent } from "../src/worker/events";
import wrangler from "../wrangler.jsonc?raw";
import { approveMember, createTestEvent, setUpAdmin } from "./helpers";

const db = env.DB;

describe("migration 0023 on data from before it", () => {
  it("adds the columns and tables and makes the Owner every event's manager and payee", async () => {
    const mdb = env.MIGRATION_DB;
    await applyD1Migrations(
      mdb,
      env.TEST_MIGRATIONS.filter((m) => m.name < "0023"),
    );
    const ts = "2026-10-01T00:00:00.000Z";
    await mdb.batch([
      mdb
        .prepare(
          `INSERT INTO members (id, username, wechat_nickname, status, is_owner, requested_at)
         VALUES ('M001', 'Jay', 'Jay', 'active', 1, ?), ('M002', 'Alice', 'Alice', 'active', 0, ?)`,
        )
        .bind(ts, ts),
      mdb
        .prepare(
          `INSERT INTO events (id, number, code, date, start_at, end_at, location, deadline_at, deadline_offset_min, status, created_at)
         VALUES (1, 'jbm20261006', '1006', '2026-10-06', ?, ?, 'Gym', ?, 1440, 'open', ?),
                (2, 'jbm20260920', '0920', '2026-09-20', ?, ?, 'Gym', ?, 1440, 'finalized', ?)`,
        )
        .bind(ts, ts, ts, ts, ts, ts, ts, ts),
      mdb
        .prepare(
          `INSERT INTO inbound_payments (venmo_txn_id, payer_name, amount_cents, note, received_at, kind)
         VALUES ('t1', 'Alice', 1200, 'x', ?, 'unmatched')`,
        )
        .bind(ts),
    ]);

    await applyD1Migrations(mdb, env.TEST_MIGRATIONS);

    const events = await mdb.prepare("SELECT id, manager_id, payee_id FROM events ORDER BY id").all();
    expect(events.results).toEqual([
      { id: 1, manager_id: "M001", payee_id: "M001" },
      { id: 2, manager_id: "M001", payee_id: "M001" },
    ]);
    const members = await mdb.prepare("SELECT id, role, role_since FROM members ORDER BY id").all();
    expect(members.results).toEqual([
      { id: "M001", role: "member", role_since: null },
      { id: "M002", role: "member", role_since: null },
    ]);
    // Every payment so far went into the Owner's account.
    expect(await mdb.prepare("SELECT payee_id FROM inbound_payments").first()).toEqual({ payee_id: "M001" });
    for (const t of ["payment_profiles", "payment_aliases", "telegram_bindings", "event_audit"])
      expect(await mdb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).toEqual({ n: 0 });
    // The new tables' rules: one Venmo account per person, compared without case.
    await mdb
      .prepare("INSERT INTO payment_profiles (member_id, venmo_username, updated_at) VALUES ('M002', 'Alice-V', ?)")
      .bind(ts)
      .run();
    await expect(
      mdb
        .prepare("INSERT INTO payment_profiles (member_id, venmo_username, updated_at) VALUES ('M001', 'alice-v', ?)")
        .bind(ts)
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe("migration 0023 on a site not yet set up", () => {
  it("leaves manager and payee empty when there is no Owner, which still reads as the Owner", async () => {
    const mdb = env.MIGRATION_DB_EMPTY;
    await applyD1Migrations(
      mdb,
      env.TEST_MIGRATIONS.filter((m) => m.name < "0023"),
    );
    await mdb
      .prepare(
        `INSERT INTO events (id, number, code, date, start_at, end_at, location, deadline_at, deadline_offset_min, status, created_at)
         VALUES (7, 'jbm20261006', '1006', '2026-10-06', 'x', 'x', 'Gym', 'x', 1440, 'open', 'x')`,
      )
      .run();
    await applyD1Migrations(mdb, env.TEST_MIGRATIONS);
    const e = await mdb.prepare("SELECT manager_id, payee_id FROM events WHERE id = 7").first<{
      manager_id: string | null;
      payee_id: string | null;
    }>();
    expect(e).toEqual({ manager_id: null, payee_id: null });
    expect(await eventManager(mdb, e!)).toBeNull();
    expect(await eventPayee(mdb, e!)).toBeNull();
  });
});

describe("reading an event's manager and payee", () => {
  it("treats an empty column as the Owner and otherwise reads it as stored", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const owner = await ownerId(db);
    expect(owner).toBe("M001");
    expect(await eventManager(db, { manager_id: null })).toBe(owner);
    expect(await eventPayee(db, { payee_id: null })).toBe(owner);
    expect(await eventManager(db, { manager_id: alice.id })).toBe(alice.id);
    expect(await eventPayee(db, { payee_id: alice.id })).toBe(alice.id);
  });

  it("fills both columns with the Owner when an event is created", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const row = await db.prepare("SELECT manager_id, payee_id FROM events WHERE id = ?").bind(e.id).first();
    expect(row).toEqual({ manager_id: "M001", payee_id: "M001" });
  });
});

describe("payeeProfile", () => {
  it("reads the Owner's settings and an organizer's own row", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    await ctx.admin.call(`${ctx.base}/settings/payment`, {
      password: "initial-password",
      venmoUsername: "jay-v",
      venmoEmail: "jay@example.com",
      zelleAccount: "jay@bank",
    });
    expect(await payeeProfile(db, "M001")).toEqual({
      memberId: "M001",
      venmoUsername: "jay-v",
      venmoEmail: "jay@example.com",
      zelleAccount: "jay@bank",
    });

    await db
      .prepare(
        "INSERT INTO payment_profiles (member_id, venmo_username, venmo_email, updated_at) VALUES (?, 'alice-v', 'a@example.com', 'x')",
      )
      .bind(alice.id)
      .run();
    expect(await payeeProfile(db, alice.id)).toEqual({
      memberId: alice.id,
      venmoUsername: "alice-v",
      venmoEmail: "a@example.com",
      zelleAccount: "",
    });
    expect(await payeeProfile(db, bob.id)).toBeNull();
    expect(await payeeProfile(db, "M999")).toBeNull();
    expect(await payeeProfile(db, null)).toBeNull();
  });

  it("is null for anyone with nothing filled in, the Owner included", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    expect(await payeeProfile(db, "M001")).toBeNull();
    await db.prepare("INSERT INTO payment_profiles (member_id, updated_at) VALUES (?, 'x')").bind(alice.id).run();
    expect(await payeeProfile(db, alice.id)).toBeNull();
  });
});

describe("memberRole", () => {
  const on = { ORGANIZERS: "1" };
  const off = { ORGANIZERS: "0" };
  const base = { is_owner: 0, role: "organizer", status: "active", deleted_at: null };

  it("is the Owner for the Owner, flag or not", () => {
    expect(memberRole(off, { ...base, is_owner: 1, role: "member" })).toBe("owner");
    expect(memberRole(on, { ...base, is_owner: 1, role: "member" })).toBe("owner");
  });

  it("is an organizer only while active, not deleted, and the flag is on", () => {
    expect(memberRole(on, base)).toBe("organizer");
    expect(memberRole(off, base)).toBe("member");
    expect(memberRole({}, base)).toBe("member");
    expect(memberRole(on, { ...base, status: "inactive" })).toBe("member");
    expect(memberRole(on, { ...base, deleted_at: "2026-10-01" })).toBe("member");
    expect(memberRole(on, { ...base, role: "member" })).toBe("member");
    expect(memberRole(on, { ...base, role: "admin" })).toBe("member");
  });
});

describe("capabilities", () => {
  it("gives the Owner every capability and an organizer exactly the five in the design", () => {
    expect([...ROLE_CAPABILITIES.owner].sort()).toEqual(
      ["event", "events.create", "group", "members.read", "payee", "self", "system"].sort(),
    );
    expect([...ROLE_CAPABILITIES.organizer].sort()).toEqual(
      ["event", "events.create", "members.read", "payee", "self"].sort(),
    );
    expect(ROLE_CAPABILITIES.member).toEqual([]);
    expect(can("organizer", "group")).toBe(false);
    expect(can("owner", "system")).toBe(true);
  });
});

describe("the ORGANIZERS flag", () => {
  it("is off in production and on on the test site", () => {
    expect(organizersEnabled({ ORGANIZERS: "0" })).toBe(false);
    expect(organizersEnabled({})).toBe(false);
    expect(organizersEnabled({ ORGANIZERS: "1" })).toBe(true);
    // JSONC: drop whole-line comments and trailing commas (strings hold URLs, so not every //).
    const config = JSON.parse(
      wrangler
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n")
        .replace(/,(\s*[}\]])/g, "$1"),
    );
    expect(config.vars.ORGANIZERS).toBe("0");
    expect(config.env.staging.vars.ORGANIZERS).toBe("1");
  });
});

describe("清空所有数据", () => {
  it("empties the new tables too", async () => {
    const ctx = await setUpAdmin();
    const alice = await approveMember(ctx, "Alice");
    const e = await createTestEvent(ctx);
    await db.batch([
      db.prepare("INSERT INTO payment_profiles (member_id, updated_at) VALUES (?, 'x')").bind(alice.id),
      db
        .prepare(
          "INSERT INTO payment_aliases (venmo_username, venmo_email, member_id, until) VALUES ('a', 'b', ?, 'x')",
        )
        .bind(alice.id),
      db.prepare("INSERT INTO telegram_bindings (member_id, chat_id) VALUES (?, '42')").bind(alice.id),
      db
        .prepare("INSERT INTO event_audit (event_id, actor_id, action, at) VALUES (?, 'M001', 'roster_add', 'x')")
        .bind(e.id),
    ]);
    const res = await ctx.admin.call(`${ctx.base}/settings/reset`, {
      confirm: "清空所有数据",
      password: "initial-password",
    });
    expect(res.status).toBe(200);
    for (const t of ["payment_profiles", "payment_aliases", "telegram_bindings", "event_audit"])
      expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).toEqual({ n: 0 });
  });
});

describe("从数据库永久删除", () => {
  it("takes the event's 操作记录 with it", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    await db
      .prepare("INSERT INTO event_audit (event_id, actor_id, action, at) VALUES (?, 'M001', 'roster_add', 'x')")
      .bind(e.id)
      .run();
    await db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").bind(e.id).run();
    await deleteEvent(env, await getEvent(env, e.id));
    expect(await db.prepare("SELECT COUNT(*) AS n FROM event_audit").first()).toEqual({ n: 0 });
  });
});
