import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { handBackIfRevoked, revokeOrganizer } from "../src/worker/appointments";
import { handleEmail } from "../src/worker/inbound";
import { requireMember } from "../src/worker/members";
import { dollars } from "../src/shared/settle";
import {
  appoint,
  approveMember,
  billingScenario,
  Client,
  createTestEvent,
  expire,
  futureDate,
  GOOGLE,
  ORIGIN,
  request,
  setUpAdmin,
} from "./helpers";
import { testKey, venmoEmail, type ReceiptFields } from "./venmoMail";

/** Card 9: 操作记录, one entry per change with who made it. */

let resolveKey: Awaited<ReturnType<typeof testKey>>["resolveKey"];
beforeAll(async () => {
  resolveKey = (await testKey()).resolveKey;
});

const on = { ...env, SITE_ORIGIN: ORIGIN, ORGANIZERS: "1" };
const deliver = async (fields: ReceiptFields) => handleEmail(env, (await venmoEmail(fields)).raw, { resolveKey });
const json = async (res: Response) => ({ status: res.status, data: (await res.json()) as any });

type Row = { actor_id: string; action: string; detail: string };
const log = async (eventId: number) =>
  (
    await env.DB.prepare("SELECT actor_id, action, detail FROM event_audit WHERE event_id = ? ORDER BY id")
      .bind(eventId)
      .all<Row>()
  ).results;
/** The entries added by `fn`, so each step asserts exactly what it recorded. */
async function added(eventId: number, fn: () => unknown): Promise<Row[]> {
  const before = (await log(eventId)).length;
  await fn();
  return (await log(eventId)).slice(before);
}
const ownerId = async () =>
  (await env.DB.prepare("SELECT id FROM members WHERE is_owner = 1").first<{ id: string }>())!.id;

describe("what the Owner does", () => {
  it("records every change to the roster and the event, with the Owner as actor (flag off too)", async () => {
    const ctx = await setUpAdmin();
    const owner = await ownerId();
    const alice = await approveMember(ctx, "Alice");
    const e = await createTestEvent(ctx, { joinSelf: true, title: "周三" });
    const eb = `${ctx.base}/events/${e.id}`;
    expect((await log(e.id)).map((r) => [r.actor_id, r.action])).toEqual([
      [owner, "create"],
      [owner, "self_signup"],
    ]);

    expect(
      await added(e.id, () =>
        ctx.admin.call(`${eb}/roster/add`, { memberId: alice.id, includeSelf: true, friends: ["Tom"] }),
      ),
    ).toEqual([{ actor_id: owner, action: "roster_add", detail: "添加 Alice、Alice 带的 1 个朋友" }]);
    const tom = (await ctx.admin.call(eb)).data.roster.find((r: { name: string }) => r.name === "Tom");
    expect(await added(e.id, () => ctx.admin.call(`${eb}/roster/${tom.id}/rename`, { name: "Tommy" }))).toEqual([
      { actor_id: owner, action: "roster_rename", detail: "把 Tom（Alice 带的朋友） 改名为 Tommy（Alice 带的朋友）" },
    ]);
    expect(await added(e.id, () => ctx.admin.call(`${eb}/self-signup`, { friends: ["Ann"] }))).toEqual([
      { actor_id: owner, action: "self_signup", detail: "自己报名，带 1 个朋友：Ann" },
    ]);
    // Saved again unchanged: nothing.
    expect(await added(e.id, () => ctx.admin.call(`${eb}/self-signup`, { friends: ["Ann"] }))).toEqual([]);
    expect((await added(e.id, () => ctx.admin.call(`${eb}/self-cancel`, {}))).map((r) => r.action)).toEqual([
      "self_cancel",
    ]);
    expect(await added(e.id, () => ctx.admin.call(`${eb}/self-cancel`, {}))).toEqual([]);
    expect((await added(e.id, () => ctx.admin.call(`${eb}/close-now`, {}))).map((r) => r.action)).toEqual([
      "close_now",
    ]);
    // Attendance and removal only on an actual change; a repeated click records nothing more.
    expect(
      await added(e.id, () => ctx.admin.call(`${eb}/attendance`, { registrationId: tom.id, attended: false })),
    ).toEqual([{ actor_id: owner, action: "attendance", detail: "把 Tommy（Alice 带的朋友） 标为未出席" }]);
    expect(
      await added(e.id, () => ctx.admin.call(`${eb}/attendance`, { registrationId: tom.id, attended: false })),
    ).toEqual([]);
    const reopen = await added(e.id, () => ctx.admin.call(`${eb}/reopen`, { date: futureDate(7), time: "18:00" }));
    expect(reopen).toEqual([
      { actor_id: owner, action: "reopen", detail: `重新开放报名，截止到 ${futureDate(7)} 18:00` },
    ]);
    const edit = await added(e.id, () =>
      ctx.admin.call(`${eb}/edit`, {
        date: futureDate(7),
        startTime: "19:00",
        endTime: "22:00",
        location: "Other Gym",
        title: "周三",
      }),
    );
    expect(edit).toEqual([
      {
        actor_id: owner,
        action: "edit",
        detail: "修改活动：时间 19:00–21:00 → 19:00–22:00；场馆 Bay Badminton Center → Other Gym",
      },
    ]);
    // Saving without a change records nothing.
    expect(
      await added(e.id, () =>
        ctx.admin.call(`${eb}/edit`, {
          date: futureDate(7),
          startTime: "19:00",
          endTime: "22:00",
          location: "Other Gym",
          title: "周三",
        }),
      ),
    ).toEqual([]);
    expect(await added(e.id, () => ctx.admin.call(`${eb}/roster/${tom.id}/remove`, {}))).toEqual([
      { actor_id: owner, action: "roster_remove", detail: "把 Tommy（Alice 带的朋友） 移出名单" },
    ]);
    expect(await added(e.id, () => ctx.admin.call(`${eb}/cancel`, {}))).toEqual([
      { actor_id: owner, action: "cancel", detail: "取消活动" },
    ]);

    // The Owner reads it from the event page, newest first, named 群主.
    const read = (await ctx.admin.call(`${eb}/audit`)).data.entries;
    expect(read[0]).toMatchObject({ actor: "群主", action: "cancel", detail: "取消活动" });
    expect(read.at(-1)).toMatchObject({ actor: "群主", action: "create" });

    // Deleting the event for good takes its log with it.
    await ctx.admin.call(`${eb}/delete`, { password: "initial-password" });
    expect(await log(e.id)).toEqual([]);
  });

  it("records fees, bills and payments, and auto-matching as the system", async () => {
    const s = await billingScenario();
    const id = s.e.id as number;
    expect(await added(id, () => s.admin.call(`${s.eb}/finalize`, s.fees))).toEqual([
      { actor_id: s.owner, action: "finalize", detail: "Finalize 发出账单：场地 $100.00，用球 6 个 × $3.00" },
    ]);
    expect(await added(id, () => s.admin.call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "120" }))).toEqual([
      {
        actor_id: s.owner,
        action: "fee_edit",
        detail: "修改费用：场地 $120.00，用球 6 个 × $3.00（原来：场地 $100.00，用球 6 个 × $3.00）",
      },
    ]);
    expect(await added(id, () => s.admin.call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "120" }))).toEqual([]);
    const bills = async () =>
      Object.fromEntries(
        (await s.admin.call(`${s.eb}/settlement`)).data.payments.map((p: { memberName: string }) => [p.memberName, p]),
      ) as Record<string, any>;
    let b = await bills();

    expect(await added(id, () => s.admin.call(`${s.eb}/dunning`, { stop: true }))).toEqual([
      { actor_id: s.owner, action: "dunning_stop", detail: "停止账单提醒" },
    ]);
    expect((await added(id, () => s.admin.call(`${s.eb}/dunning`, { stop: false }))).map((r) => r.action)).toEqual([
      "dunning_resume",
    ]);

    // Alice: cash, then taken back.
    expect(await added(id, () => s.admin.call(`${s.base}/payments/${b.Alice.id}/mark-paid`, {}))).toEqual([
      {
        actor_id: s.owner,
        action: "mark_paid",
        detail: `把 Alice 的账单标记为已付（记一笔 $${dollars(b.Alice.amountDueCents)}）`,
      },
    ]);
    b = await bills();
    const cash = b.Alice.receipts.find((r: { method: string }) => r.method === "manual");
    expect(await added(id, () => s.admin.call(`${s.base}/receipts/${cash.id}/remove`, {}))).toEqual([
      {
        actor_id: s.owner,
        action: "receipt_remove",
        detail: `撤销 Alice 账单上的一笔手动记的付款 $${dollars(b.Alice.amountDueCents)}`,
      },
    ]);

    // Bob pays by Venmo with a mistyped code (待确认, linked by the Owner), Alice exactly by Venmo
    // (auto-matched), which collects the event.
    const day = b.Bob.paymentCode.split("-")[1];
    await deliver({ amount: "1.00", note: `bob-${day}-m099`, txnId: "W0" });
    const stray = (await s.admin.call(`${s.base}/inbound`)).data.open[0];
    expect(await added(id, () => s.admin.call(`${s.base}/inbound/${stray.id}/ignore`, {}))).toEqual([
      { actor_id: s.owner, action: "inbound_ignore", detail: "忽略付到 群主 账户的 Venmo 收款（Alice W $1.00）" },
    ]);
    await deliver({ amount: dollars(b.Bob.amountDueCents), note: `bob-${day}-m098`, txnId: "W1" });
    const open = (await s.admin.call(`${s.base}/inbound`)).data.open[0];
    expect(await added(id, () => s.admin.call(`${s.base}/inbound/${open.id}/link`, { paymentId: b.Bob.id }))).toEqual([
      {
        actor_id: s.owner,
        action: "inbound_link",
        detail: `把待确认的 Venmo 收款（Alice W $${dollars(b.Bob.amountDueCents)}）关联到 Bob 的账单`,
      },
    ]);
    const auto = await added(id, async () =>
      expect(
        await deliver({ amount: dollars(b.Alice.amountDueCents + 500), note: b.Alice.paymentCode, txnId: "W2" }),
      ).toBe("overpaid"),
    );
    expect(auto).toEqual([
      {
        actor_id: "system",
        action: "auto_match",
        detail: `Venmo 自动对账：Alice W 付 $${dollars(b.Alice.amountDueCents + 500)}，记到 Alice 的账单`,
      },
      { actor_id: "system", action: "collected", detail: "全部付清，自动收齐归档" },
    ]);
    expect(await added(id, () => s.admin.call(`${s.base}/payments/${b.Alice.id}/refunded`, {}))).toEqual([
      { actor_id: s.owner, action: "refund", detail: "Alice 多付的 $5.00 已退款" },
    ]);
    const read = (await s.admin.call(`${s.eb}/audit`)).data.entries;
    expect(read.find((r: { action: string }) => r.action === "auto_match").actor).toBe("系统");
  });

  it("a failed change records nothing", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const eb = `${ctx.base}/events/${e.id}`;
    expect(await added(e.id, () => ctx.admin.call(`${eb}/reopen`, { date: futureDate(7), time: "18:00" }))).toEqual([]); // still open
    expect(
      await added(e.id, () =>
        ctx.admin.call(`${eb}/finalize`, { courtTotal: "1", shuttleCount: 0, shuttlePrice: "0" }),
      ),
    ).toEqual([]);
  });
});

describe("organizers and the log", () => {
  async function scenario() {
    const ctx = await setUpAdmin();
    const owner = await ownerId();
    const alice = await approveMember(ctx, "Alice");
    const bob = await approveMember(ctx, "Bob");
    const org = await appoint(alice.id, "alice");
    await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "alice-v", venmoEmail: "alice@venmo.test" });
    const theirs = (await createTestEvent(ctx)).id as number;
    const mine = (
      await json(
        await request(`${GOOGLE}/events`, org, {
          date: futureDate(8),
          startTime: "18:30",
          endTime: "20:30",
          location: "Alice Gym",
          deadlineDays: 2,
          deadlineHours: 0,
        }),
      )
    ).data.id as number;
    return { ctx, owner, alice, bob, org, theirs, mine };
  }

  it("records an organizer's own changes under their id, and shows them only their events' logs", async () => {
    const { ctx, alice, bob, org, theirs, mine } = await scenario();
    expect((await log(mine)).map((r) => [r.actor_id, r.action])).toEqual([[alice.id, "create"]]);
    expect(
      await added(mine, () =>
        request(`${GOOGLE}/events/${mine}/roster/add`, org, { memberId: bob.id, includeSelf: true }),
      ),
    ).toEqual([{ actor_id: alice.id, action: "roster_add", detail: "添加 Bob" }]);
    await expire(mine);
    const fin = await added(mine, () =>
      request(`${GOOGLE}/events/${mine}/finalize`, org, { courtTotal: "40", shuttleCount: 2, shuttlePrice: "3" }),
    );
    expect(fin.map((r) => [r.actor_id, r.action])).toEqual([[alice.id, "finalize"]]);

    const own = await json(await request(`${GOOGLE}/events/${mine}/audit`, org));
    expect(own.status).toBe(200);
    expect(own.data.entries.map((r: { actor: string }) => r.actor)).toEqual(["Alice", "Alice", "Alice"]);
    // Not the Owner's event's, nor one that doesn't exist.
    expect((await request(`${GOOGLE}/events/${theirs}/audit`, org)).status).toBe(403);
    expect((await request(`${GOOGLE}/events/999999/audit`, org)).status).toBe(403);
    // The Owner sees hers.
    expect((await ctx.admin.call(`${ctx.base}/events/${mine}/audit`)).data.entries).toHaveLength(3);
    // A member's link can't read any.
    expect((await new Client().call(`/api/m/x/events/${mine}/audit`)).status).not.toBe(200);
  });

  it("records 转交 and the hand-back when an organizer is revoked", async () => {
    const { ctx, owner, alice, bob, org, theirs, mine } = await scenario();
    const res = await request(`${ctx.base}/events/${theirs}/transfer`, ctx.admin.cookie, { to: alice.id });
    expect(res.status).toBe(200);
    expect((await log(theirs)).filter((r) => r.action === "transfer")).toEqual([
      { actor_id: owner, action: "transfer", detail: "把活动从 群主 转交给 Alice，收款人一起换" },
    ]);

    // Again to the same person: nothing changes, nothing recorded.
    expect(
      await added(theirs, () => request(`${ctx.base}/events/${theirs}/transfer`, ctx.admin.cookie, { to: alice.id })),
    ).toEqual([]);

    // Her own event has bills out, so its money stays in her account after she is revoked.
    await request(`${GOOGLE}/events/${mine}/roster/add`, org, { memberId: bob.id, includeSelf: true });
    await expire(mine);
    const fin = { courtTotal: "40", shuttleCount: 2, shuttlePrice: "3" };
    expect((await request(`${GOOGLE}/events/${mine}/finalize`, org, fin)).status).toBe(200);

    // Revoked by the Owner: both of her events go back, each recorded under the Owner.
    await revokeOrganizer(on, await requireMember(on, alice.id), "owner");
    expect((await log(theirs)).filter((r) => r.action === "reassign")).toEqual([
      { actor_id: owner, action: "reassign", detail: "撤销 Alice 的组织者身份，活动交回群主" },
    ]);
    expect((await log(mine)).filter((r) => r.action === "reassign")).toEqual([
      {
        actor_id: owner,
        action: "reassign",
        detail: "撤销 Alice 的组织者身份，活动交回群主（账单已发出，钱仍付到 Alice 的账户）",
      },
    ]);
    // An event created a moment after being revoked goes to the Owner, recorded as the system's.
    const late = await createTestEvent(ctx);
    await env.DB.prepare("UPDATE events SET manager_id = ?, payee_id = ? WHERE id = ?")
      .bind(alice.id, alice.id, late.id)
      .run();
    await handBackIfRevoked(on, late.id, alice.id);
    expect((await log(late.id)).at(-1)).toMatchObject({ actor_id: "system", action: "reassign" });
  });

  it("names the account the money is in when the Owner links a payment made to the wrong payee", async () => {
    const s = await billingScenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const org = await appoint(s.alice.id, "alice");
    await request(`${GOOGLE}/payment-profile`, org, { venmoUsername: "Alice-V", venmoEmail: "alice@venmo.test" });
    const bob = (await s.admin.call(`${s.eb}/settlement`)).data.payments.find(
      (p: { memberName: string }) => p.memberName === "Bob",
    );
    // Bob pays the Owner's event into Alice's account: 待确认 in hers, linked by the Owner.
    expect(
      await handleEmail(
        on,
        (
          await venmoEmail({
            amount: dollars(bob.amountDueCents),
            note: bob.paymentCode,
            txnId: "X1",
            sentTo: "Alice-V",
            to: "alice@venmo.test",
          })
        ).raw,
        { resolveKey },
      ),
    ).toBe("review");
    const row = (await env.DB.prepare("SELECT id FROM inbound_payments WHERE venmo_txn_id = 'X1'").first<{
      id: number;
    }>())!;
    const linked = await added(s.e.id, () => s.admin.call(`${s.base}/inbound/${row.id}/link`, { paymentId: bob.id }));
    expect(linked).toEqual([
      {
        actor_id: s.owner,
        action: "inbound_link",
        detail: `把待确认的 Venmo 收款（Alice W $${dollars(bob.amountDueCents)}）关联到 Bob 的账单；钱在 Alice 的账户`,
      },
    ]);
  });
});
