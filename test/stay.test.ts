import { describe, expect, it } from "vitest";
import { arriveChoices, checkStay, headcountSlots, leaveChoices } from "../src/shared/stay";
import { Client, approveMember, createTestEvent, setUpAdmin } from "./helpers";

// 在场时间 (Ke Li 2026-11-06): optional 到 / 走 on a sign-up; 走 only with 到; 15-minute steps
// inside the event's time; people with only 到 count until the end.

describe("在场时间 rules", () => {
  it("offers 15-minute steps inside the event, past midnight too", () => {
    expect(arriveChoices("19:00", "20:00")).toEqual(["19:00", "19:15", "19:30", "19:45"]);
    expect(leaveChoices("19:00", "20:00", "19:30")).toEqual(["19:45", "20:00"]);
    expect(arriveChoices("23:00", "00:30")).toEqual(["23:00", "23:15", "23:30", "23:45", "00:00", "00:15"]);
    // An end off the grid is still offered as the last 走.
    expect(leaveChoices("19:00", "20:10", "19:45")).toEqual(["20:00", "20:10"]);
  });

  it("takes both, only 到, or neither, but not 走 alone", () => {
    expect(checkStay("08:00", "23:00", "10:15", "14:00")).toEqual({ arrive: "10:15", leave: "14:00" });
    expect(checkStay("08:00", "23:00", "10:15", null)).toEqual({ arrive: "10:15", leave: null });
    expect(checkStay("08:00", "23:00", "", "")).toEqual({ arrive: null, leave: null });
    expect(checkStay("08:00", "23:00", null, "14:00")).toBe("请先选到的时间");
    expect(typeof checkStay("08:00", "23:00", "07:45", null)).toBe("string");
    expect(typeof checkStay("08:00", "23:00", "10:10", null)).toBe("string");
    expect(typeof checkStay("08:00", "23:00", "10:00", "10:00")).toBe("string");
    expect(typeof checkStay("08:00", "23:00", "10:00", "23:15")).toBe("string");
  });

  it("counts each 15 minutes, only-到 until the end, nobody without 到", () => {
    const slots = headcountSlots("19:00", "20:00", [
      { arrive: "19:00", leave: "19:30" },
      { arrive: "19:15", leave: null },
      { arrive: null, leave: null },
    ]);
    expect(slots).toEqual([1, 2, 1, 1]);
  });
});

describe("在场时间 on a sign-up", () => {
  const anon = new Client();

  it("is saved, shown on the roster for friends too, kept when an old page leaves it out", async () => {
    const ctx = await setUpAdmin();
    const ke = await approveMember(ctx, "Ke");
    const bob = await approveMember(ctx, "Bob");
    const e = await createTestEvent(ctx, { startTime: "08:00", endTime: "23:00" });
    const up = (who: { base: string }, body: unknown) => anon.call(`${who.base}/events/${e.id}/signup`, body);

    expect((await up(ke, { friends: ["小王"], leave: "14:00" })).status).toBe(400);
    expect((await up(ke, { friends: ["小王"], arrive: "10:15", leave: "14:00" })).status).toBe(200);
    expect((await up(bob, { friends: [] })).status).toBe(200);

    const card = (await anon.call(`${ke.base}/events/${e.id}`)).data.event;
    expect(card.myStay).toEqual({ arrive: "10:15", leave: "14:00" });
    expect(card.roster.map((r: any) => [r.name, r.arrive, r.leave])).toEqual([
      ["Ke", "10:15", "14:00"],
      ["小王", "10:15", "14:00"],
      ["Bob", null, null],
    ]);

    // A page from before this sends no times: they stay as they were.
    expect((await up(ke, { friends: [] })).status).toBe(200);
    expect((await anon.call(`${ke.base}/events/${e.id}`)).data.event.myStay).toEqual({
      arrive: "10:15",
      leave: "14:00",
    });
    // Cleared.
    expect((await up(ke, { friends: [], arrive: null, leave: null })).status).toBe(200);
    expect((await anon.call(`${ke.base}/events/${e.id}`)).data.event.myStay).toEqual({ arrive: null, leave: null });

    const admin = (await ctx.admin.call(`${ctx.base}/events/${e.id}`)).data;
    expect(admin.roster.every((r: any) => "arrive" in r)).toBe(true);
  });
});
