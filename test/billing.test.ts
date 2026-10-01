import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { Client, billingScenario as scenario, createTestEvent, expire, setUpAdmin } from "./helpers";

const anon = new Client();
type Scenario = Awaited<ReturnType<typeof scenario>>;

const payment = async (s: Scenario, name: string) =>
  (await s.admin.call(`${s.eb}/settlement`)).data.payments.find((p: { memberName: string }) => p.memberName === name);

describe("settlement", () => {
  it("previews, finalizes and bills each member for themselves and their friends", async () => {
    const s = await scenario();
    const preview = (await s.admin.call(`${s.eb}/preview`, s.fees)).data;
    expect(preview).toMatchObject({ registered: 4, attended: 3, courtShareCents: 2500, shuttleShareCents: 600 });

    expect((await s.admin.call(`${s.eb}/finalize`, s.fees)).status).toBe(200);
    expect(await payment(s, "Alice")).toMatchObject({ amountDueCents: 3100 + 2500, status: "unpaid", paymentCode: `alice-jbm${s.e.date.replace(/-/g, "")}-${s.alice.id.toLowerCase()}` });
    expect(await payment(s, "Bob")).toMatchObject({ amountDueCents: 3100, status: "unpaid" });
    expect(await payment(s, "Jay")).toMatchObject({ amountDueCents: 3100, status: "paid", amountPaidCents: 3100 });
    expect((await payment(s, "Jay")).receipts).toMatchObject([{ method: "manual", amountCents: 3100 }]);

    const mine = (await anon.call(`${s.alice.base}/events`)).data.events[0];
    expect(mine.payment).toMatchObject({ amountCents: 5600, status: "unpaid", venmoUsername: "KeLi8916", zelleAccount: "jay@example.com" });
    expect(mine.payment.shares.map((x: { name: string; shuttleCents: number }) => [x.name, x.shuttleCents])).toEqual([["Alice", 600], ["Tom", 0]]);
    // The public page shows attendance but never money.
    const pub = (await anon.call(`/api/public/events/${s.e.code}`)).data;
    expect(pub.showAttendance).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("5600");
  });

  it("refuses to settle before the deadline", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const res = await ctx.admin.call(`${ctx.base}/events/${e.id}/preview`, { courtTotal: "10", shuttleCount: 1, shuttlePrice: "3" });
    expect(res.data.error.message).toBe("报名还没截止，不能结算");
  });

  it("recomputes unpaid bills after Finalize but leaves paid ones alone", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const alicePay = await payment(s, "Alice");
    await s.admin.call(`${s.base}/payments/${alicePay.id}/mark-paid`, {});

    // A walk-in hung under Bob: 5 registered, 4 attended.
    await s.admin.call(`${s.eb}/roster/add`, { memberId: s.bob.id, includeSelf: false, friends: ["路人"] });
    expect(await payment(s, "Alice")).toMatchObject({ amountDueCents: 5600, status: "paid" });
    expect((await payment(s, "Bob")).amountDueCents).toBe(2 * (2000 + 450));

    // Changing the fees later updates only the unpaid bill too.
    await s.admin.call(`${s.eb}/finalize`, { ...s.fees, courtTotal: "120" });
    expect((await payment(s, "Bob")).amountDueCents).toBe(2 * (2400 + 450));
    expect((await payment(s, "Alice")).amountDueCents).toBe(5600);
  });

  it("drops an unpaid bill when the member leaves the roster", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const d = (await s.admin.call(s.eb)).data;
    const bobRow = d.roster.find((r: { name: string }) => r.name === "Bob");
    await s.admin.call(`${s.eb}/roster/${bobRow.id}/remove`, {});
    expect(await payment(s, "Bob")).toBeUndefined();
  });
});

describe("collection and archive", () => {
  it("archives the moment everyone is paid, then locks the event", async () => {
    const s = await scenario();
    await s.admin.call(`${s.eb}/finalize`, s.fees);
    const a = await payment(s, "Alice");
    const b = await payment(s, "Bob");
    expect((await s.admin.call(`${s.base}/payments/${a.id}/mark-paid`, {})).data.settled).toBe(false);
    const receipt = (await payment(s, "Alice")).receipts[0];
    await s.admin.call(`${s.base}/receipts/${receipt.id}/remove`, {});
    expect(await payment(s, "Alice")).toMatchObject({ status: "unpaid", amountPaidCents: 0, receipts: [] });
    await s.admin.call(`${s.base}/payments/${a.id}/mark-paid`, {});
    expect((await s.admin.call(`${s.base}/payments/${b.id}/mark-paid`, {})).data.settled).toBe(true);

    const ev = (await s.admin.call(s.eb)).data;
    expect(ev.status).toBe("settled");
    const add = await s.admin.call(`${s.eb}/roster/add`, { memberId: s.bob.id, includeSelf: false, friends: ["x"] });
    expect(add.data.error.message).toBe("这个活动已收齐归档，不能再修改");
    const paid = (await payment(s, "Alice")).receipts[0];
    expect((await s.admin.call(`${s.base}/receipts/${paid.id}/remove`, {})).data.error.message).toBe("这个活动已收齐归档，不能再修改");
    expect((await s.admin.call(`${s.eb}/finalize`, s.fees)).data.error.message).toBe("这个活动已收齐归档，不能再修改");

    const home = (await anon.call("/api/public/home")).data;
    expect(home.pastEvents[0].status).toBe("settled");
    const mine = (await anon.call(`${s.bob.base}/events`)).data.events[0];
    expect(mine.payment.status).toBe("paid");
  });

  it("archives immediately when only the Owner owes anything", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx);
    const owner = (await ctx.admin.call(`${ctx.base}/members`)).data.active[0].id;
    await ctx.admin.call(`${ctx.base}/events/${e.id}/roster/add`, { memberId: owner, includeSelf: true, friends: ["朋友"] });
    await expire(e.id);
    await ctx.admin.call(`${ctx.base}/events/${e.id}/finalize`, { courtTotal: "50", shuttleCount: 2, shuttlePrice: "3" });
    expect((await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data.status).toBe("settled");
  });

  it("validates fee inputs", async () => {
    const s = await scenario();
    const bad = await s.admin.call(`${s.eb}/finalize`, { courtTotal: "abc", shuttleCount: 1, shuttlePrice: "3" });
    expect(bad.data.error.message).toBe("请填写场地总费用（美元）");
  });
});
