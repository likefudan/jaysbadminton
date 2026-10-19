import { describe, expect, it } from "vitest";
import { parseDollars, settle, venmoLink } from "../src/shared/settle";

let nextId = 1;
const row = (memberId: string, friendIndex: number, attended = true) => ({
  id: nextId++,
  memberId,
  friendIndex,
  name: `${memberId}-${friendIndex}`,
  attended,
});

describe("settle", () => {
  it("matches the requirements example: 24 registered, 22 attended, $240 courts, 20 × $3", () => {
    const rows = Array.from({ length: 24 }, (_, i) => row(`M${i}`, 0, i < 22));
    const s = settle(rows, { courtTotalCents: 24000, shuttleCount: 20, shuttlePriceCents: 300 });
    expect(s.courtShareCents).toBe(1000);
    expect(s.shuttleShareCents).toBe(272); // 6000 / 22 = 272 remainder 16
    expect(s.shuttleExtraShares).toBe(16);
    const came = s.bills.slice(0, 22).map((b) => b.totalCents);
    expect(came.filter((c) => c === 1273)).toHaveLength(16);
    expect(came.filter((c) => c === 1272)).toHaveLength(6);
    expect(s.bills[23]!.totalCents).toBe(1000);
    expect(s.totalCents).toBe(30000);
  });

  it("splits $40 three ways to exactly $40 (one share pays the extra cent)", () => {
    const rows = [row("carol3", 0), row("carol3", 1), row("like", 0)];
    const s = settle(rows, { courtTotalCents: 4000, shuttleCount: 0, shuttlePriceCents: 300 });
    const shares = s.bills.flatMap((b) => b.shares.map((x) => x.courtCents)).sort();
    expect(shares).toEqual([1333, 1333, 1334]);
    expect(s.totalCents).toBe(4000);
  });

  it("picks who pays the extra cent at random, but the same way every time", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`M${i}`, 0));
    const fees = { courtTotalCents: 1003, shuttleCount: 0, shuttlePriceCents: 0 };
    const extra = (list: typeof rows) =>
      settle(list, fees)
        .bills.filter((b) => b.totalCents === 101)
        .map((b) => b.memberId)
        .sort();
    const first = extra(rows);
    expect(first).toHaveLength(3);
    expect(extra(rows)).toEqual(first);
    expect(extra([...rows].reverse())).toEqual(first); // not by position on the list
    // Across many events (different registrations), the first to sign up is not always picked.
    let firstPicked = 0;
    for (let n = 0; n < 50; n++) {
      const list = Array.from({ length: 3 }, (_, i) => row(`E${n}-${i}`, 0));
      if (settle(list, { courtTotalCents: 4000, shuttleCount: 0, shuttlePriceCents: 0 }).bills[0]!.totalCents === 1334)
        firstPicked++;
    }
    expect(firstPicked).toBeGreaterThan(5);
    expect(firstPicked).toBeLessThan(45);
  });

  it("always adds up to the fees exactly", () => {
    for (let n = 1; n <= 30; n++) {
      const rows = Array.from({ length: n }, (_, i) => row(`M${i % 4}`, Math.floor(i / 4), i % 3 !== 1));
      const attended = rows.filter((r) => r.attended).length;
      const s = settle(rows, { courtTotalCents: 4001 + n * 7, shuttleCount: 7, shuttlePriceCents: 333 });
      expect(s.totalCents).toBe(4001 + n * 7 + (attended ? 7 * 333 : 0));
    }
  });

  it("charges a member for each friend, one share that came carrying the leftover cent", () => {
    const rows = [row("A", 0), row("A", 1), row("A", 2, false), row("B", 0)];
    const s = settle(rows, { courtTotalCents: 10000, shuttleCount: 10, shuttlePriceCents: 100 });
    expect(s.courtShareCents).toBe(2500);
    expect(s.shuttleShareCents).toBe(333); // 1000 / 3 = 333 remainder 1
    const shuttle = s.bills.flatMap((b) => b.shares.map((x) => x.shuttleCents));
    expect(shuttle.filter((c) => c === 334)).toHaveLength(1);
    expect(s.bills.find((b) => b.memberId === "A")!.shares[2]!.shuttleCents).toBe(0); // absent
    const a = s.bills.find((b) => b.memberId === "A")!;
    expect(a.totalCents).toBe(a.shares.reduce((t, x) => t + x.courtCents + x.shuttleCents, 0));
    expect(s.totalCents).toBe(11000);
  });

  it("keeps rounding every share up for settlements saved under the old rule", () => {
    const rows = [row("carol3", 0), row("carol3", 1), row("like", 0)];
    const s = settle(rows, { courtTotalCents: 4000, shuttleCount: 0, shuttlePriceCents: 300, roundUp: true });
    expect(s.bills.map((b) => b.totalCents)).toEqual([2668, 1334]);
    expect(s.totalCents).toBe(4002);
  });

  it("works with nobody attending", () => {
    const s = settle([row("A", 0, false)], { courtTotalCents: 3000, shuttleCount: 5, shuttlePriceCents: 300 });
    expect(s.bills[0]!.totalCents).toBe(3000);
  });
});

describe("money helpers", () => {
  it("parses dollar inputs", () => {
    expect(parseDollars("240")).toBe(24000);
    expect(parseDollars("$12.5")).toBe(1250);
    expect(parseDollars("3.05")).toBe(305);
    expect(parseDollars("-1")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
  });

  it("builds Venmo links", () => {
    expect(venmoLink("@KeLi8916", 1273, "xiaoming-jbm20261006-m007")).toBe(
      "https://venmo.com/?txn=pay&recipients=KeLi8916&amount=12.73&note=xiaoming-jbm20261006-m007",
    );
  });
});
