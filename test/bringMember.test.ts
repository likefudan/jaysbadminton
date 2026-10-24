import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toPacific } from "../src/shared/time";
import { Client, approveMember, createTestEvent, expire, setUpAdmin } from "./helpers";

// 带群友 (Ke Li 2026-10-24): a member brings another member and pays for them. The brought member
// is on the list as if they signed up themselves, but has no bill; it goes on the bringer's.

const anon = new Client();

async function setUp() {
  const ctx = await setUpAdmin();
  const ke = await approveMember(ctx, "Ke");
  const arthur = await approveMember(ctx, "arthur");
  const jay = await approveMember(ctx, "Jay2");
  const e = await createTestEvent(ctx);
  const eb = `${ctx.base}/events/${e.id}`;
  return { ...ctx, ke, arthur, jay, e, eb };
}

type Ctx = Awaited<ReturnType<typeof setUp>>;

const signup = (s: Ctx, who: { base: string }, body: unknown) => anon.call(`${who.base}/events/${s.e.id}/signup`, body);
const myCard = async (s: Ctx, who: { base: string }) => (await anon.call(`${who.base}/events/${s.e.id}`)).data.event;
const roster = async (s: Ctx) => (await s.admin.call(s.eb)).data.roster as { name: string; paidBy: string | null }[];

describe("带群友", () => {
  it("brings a member, who sees themselves signed up by the bringer and can't sign up again", async () => {
    const s = await setUp();
    expect((await signup(s, s.ke, { friends: ["小王"], guests: [s.arthur.id] })).status).toBe(200);

    const list = await roster(s);
    expect(list.map((r) => r.name)).toEqual(["Ke", "arthur", "小王"]);
    expect(list[1]!.paidBy).toBe(s.ke.id);

    const ke = await myCard(s, s.ke);
    expect(ke.myGuests).toEqual([{ id: s.arthur.id, name: "arthur" }]);
    expect(ke.myFriends).toEqual(["小王"]);

    const arthur = await myCard(s, s.arthur);
    expect(arthur.selfSignedUp).toBe(true);
    expect(arthur.broughtBy).toEqual({ name: "Ke", billed: false, paid: false });
    expect(arthur.roster.find((r: { name: string }) => r.name === "arthur")).toMatchObject({
      friendOf: null,
      mine: true,
    });
    // Others see who brought them.
    const jay = await (async () => {
      await signup(s, s.jay, { friends: [] });
      return myCard(s, s.jay);
    })();
    expect(jay.roster.find((r: { name: string }) => r.name === "arthur").friendOf).toBe("Ke");

    const self = await signup(s, s.arthur, { friends: [] });
    expect(self.status).toBe(400);
    expect(self.data.error.message).toContain("Ke 已经带你报名了");
  });

  it("can't bring someone on the list already or brought by another, nor yourself", async () => {
    const s = await setUp();
    await signup(s, s.jay, { friends: [] });
    const onList = await signup(s, s.ke, { friends: [], guests: [s.jay.id] });
    expect(onList.status).toBe(400);
    expect(onList.data.error.message).toContain("Jay2 已经在名单上了");

    await signup(s, s.jay, { friends: [], guests: [s.arthur.id] });
    const taken = await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    expect(taken.data.error.message).toContain("arthur 已经被 Jay2 带了");

    expect((await signup(s, s.ke, { friends: [], guests: [s.ke.id] })).status).toBe(400);

    const choices = (await anon.call(`${s.ke.base}/events/${s.e.id}/guests`)).data.members as {
      name: string;
      state: string;
      by: string | null;
    }[];
    expect(choices.find((c) => c.name === "Jay2")).toMatchObject({ state: "on" });
    expect(choices.find((c) => c.name === "arthur")).toMatchObject({ state: "brought", by: "Jay2" });
    expect(choices.some((c) => c.name === "Ke")).toBe(false);
  });

  it("can't bring someone who brings group members themselves", async () => {
    const s = await setUp();
    await signup(s, s.jay, { friends: [], guests: [s.arthur.id] });
    const chain = await signup(s, s.ke, { friends: [], guests: [s.jay.id] });
    expect(chain.status).toBe(400);
    const choices = (await anon.call(`${s.ke.base}/events/${s.e.id}/guests`)).data.members as {
      name: string;
      state: string;
    }[];
    expect(choices.find((c) => c.name === "Jay2")!.state).toBe("on");
  });

  it("counts group members towards the friend cap", async () => {
    const s = await setUp();
    const over = await signup(s, s.ke, { friends: ["a", "b", "c"], guests: [s.arthur.id] });
    expect(over.status).toBe(400);
    expect((await signup(s, s.ke, { friends: ["a", "b"], guests: [s.arthur.id] })).status).toBe(200);
  });

  it("keeps the group members when an older page saves without them, and drops them when unpicked", async () => {
    const s = await setUp();
    await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    await signup(s, s.ke, { friends: ["小王"] });
    expect((await roster(s)).map((r) => r.name)).toEqual(["Ke", "arthur", "小王"]);
    await signup(s, s.ke, { friends: ["小王"], guests: [] });
    expect((await roster(s)).map((r) => r.name)).toEqual(["Ke", "小王"]);
  });

  it("takes the brought member off when the bringer cancels, and 我不去了 takes only themselves", async () => {
    const s = await setUp();
    await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    await anon.call(`${s.arthur.base}/events/${s.e.id}/cancel`, {});
    expect((await roster(s)).map((r) => r.name)).toEqual(["Ke"]);
    expect((await myCard(s, s.ke)).myGuests).toEqual([]);
    // Now on their own they may sign up themselves.
    expect((await signup(s, s.arthur, { friends: [] })).status).toBe(200);
    await anon.call(`${s.arthur.base}/events/${s.e.id}/cancel`, {});

    await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    await anon.call(`${s.ke.base}/events/${s.e.id}/cancel`, {});
    expect(await roster(s)).toEqual([]);
  });

  it("bills the bringer for the brought member, who owes nothing and is settled once the bringer pays", async () => {
    const s = await setUp();
    await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    await signup(s, s.jay, { friends: [] });
    await expire(s.e.id);
    expect(
      (await s.admin.call(`${s.eb}/finalize`, { courtTotal: "90", shuttleCount: 0, shuttlePrice: "0" })).status,
    ).toBe(200);

    const { payments } = (await s.admin.call(`${s.eb}/settlement`)).data;
    const byName = new Map(payments.map((p: { memberName: string }) => [p.memberName, p]));
    expect(byName.get("Ke")).toMatchObject({ amountDueCents: 6000 });
    expect(byName.has("arthur")).toBe(false);

    const ke = await myCard(s, s.ke);
    expect(ke.payment.shares.map((x: { name: string; guest?: boolean }) => [x.name, !!x.guest])).toEqual([
      ["Ke", false],
      ["arthur", true],
    ]);

    let arthur = await myCard(s, s.arthur);
    expect(arthur.payment).toBeNull();
    expect(arthur.broughtBy).toEqual({ name: "Ke", billed: true, paid: false });

    const p = byName.get("Ke") as { id: number };
    expect((await s.admin.call(`${s.base}/payments/${p.id}/mark-paid`, {})).status).toBe(200);
    arthur = await myCard(s, s.arthur);
    expect(arthur.broughtBy).toEqual({ name: "Ke", billed: true, paid: true });
  });

  it("counts the brought member's attendance for themselves, not as the bringer's friend", async () => {
    const s = await setUp();
    await signup(s, s.ke, { friends: ["小王"], guests: [s.arthur.id] });
    await env.DB.prepare("UPDATE events SET status = 'settled', date = ? WHERE id = ?")
      .bind(toPacific(new Date()).date, s.e.id)
      .run();
    const { leaderboard } = (await anon.call("/api/public/home")).data;
    expect(leaderboard.attendance.map((r: { name: string }) => r.name).sort()).toEqual(["Ke", "arthur"]);
    expect(leaderboard.friends).toEqual([{ rank: 1, name: "Ke", value: 1 }]);
  });

  it("lets the admin page hang a group member under someone", async () => {
    const s = await setUp();
    const res = await s.admin.call(`${s.eb}/roster/add`, {
      memberId: s.ke.id,
      includeSelf: true,
      friends: [],
      guests: [s.arthur.id],
    });
    expect(res.status).toBe(200);
    expect(res.data.roster.map((r: { name: string; paidBy: string | null }) => [r.name, r.paidBy])).toEqual([
      ["Ke", null],
      ["arthur", s.ke.id],
    ]);
    // Someone brought can't bring anyone in turn.
    const chain = await s.admin.call(`${s.eb}/roster/add`, {
      memberId: s.arthur.id,
      includeSelf: false,
      friends: [],
      guests: [s.jay.id],
    });
    expect(chain.status).toBe(400);
  });
});

describe("带群友 pushes", () => {
  afterEach(() => vi.restoreAllMocks());

  /** Push turned on for these members; the push service is down, so what was queued stays to be read. */
  async function pushOn(...ids: string[]) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 503 }));
    for (const id of ids)
      await env.DB.prepare(
        "INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, 'k', 'a', ?)",
      )
        .bind(`https://fcm.googleapis.com/fcm/send/${id}`, id, new Date().toISOString())
        .run();
  }
  const pushes = async (memberId: string) =>
    (
      await env.DB.prepare("SELECT payload FROM push_outbox WHERE member_id = ? AND kind = 'roster' ORDER BY id")
        .bind(memberId)
        .all<{ payload: string }>()
    ).results.map((r) => JSON.parse(r.payload).title as string);

  it("tells the brought member when brought and taken off, and the bringer when they say they can't come", async () => {
    const s = await setUp();
    await pushOn(s.ke.id, s.arthur.id);
    await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    await signup(s, s.ke, { friends: [], guests: [] });
    expect(await pushes(s.arthur.id)).toEqual(["Ke 带你报名了", "Ke 取消了带你报名"]);

    await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    await anon.call(`${s.arthur.base}/events/${s.e.id}/cancel`, {});
    expect(await pushes(s.ke.id)).toEqual(["arthur 不去了"]);

    await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    await anon.call(`${s.ke.base}/events/${s.e.id}/cancel`, {});
    expect((await pushes(s.arthur.id)).at(-1)).toBe("Ke 取消了带你报名");

    // Taken off from the admin page: both hear of it.
    await signup(s, s.ke, { friends: [], guests: [s.arthur.id] });
    const row = (await s.admin.call(s.eb)).data.roster.find((r: { name: string }) => r.name === "arthur");
    await s.admin.call(`${s.eb}/roster/${row.id}/remove`, {});
    expect((await pushes(s.arthur.id)).at(-1)).toBe("Jay 把你移出了名单");
    expect((await pushes(s.ke.id)).at(-1)).toBe("Jay 把你的朋友移出了名单");
  });
});
