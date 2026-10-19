import { describe, expect, it } from "vitest";
import { parseDollars, settle, venmoLink } from "../src/shared/settle";

const row = (memberId: string, friendIndex: number, attended = true) => ({
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
    expect(s.bills[0]!.totalCents).toBe(1273);
    expect(s.bills[15]!.totalCents).toBe(1273);
    expect(s.bills[16]!.totalCents).toBe(1272);
    expect(s.bills[23]!.totalCents).toBe(1000);
    expect(s.totalCents).toBe(30000);
  });

  it("splits $40 three ways to exactly $40 (one share pays the extra cent)", () => {
    const rows = [row("carol3", 0), row("carol3", 1), row("like", 0)];
    const s = settle(rows, { courtTotalCents: 4000, shuttleCount: 0, shuttlePriceCents: 300 });
    expect(s.bills.map((b) => b.totalCents)).toEqual([1334 + 1333, 1333]);
    expect(s.totalCents).toBe(4000);
  });

  it("always adds up to the fees exactly", () => {
    for (let n = 1; n <= 30; n++) {
      const rows = Array.from({ length: n }, (_, i) => row(`M${i % 4}`, Math.floor(i / 4), i % 3 !== 1));
      const attended = rows.filter((r) => r.attended).length;
      const s = settle(rows, { courtTotalCents: 4001 + n * 7, shuttleCount: 7, shuttlePriceCents: 333 });
      expect(s.totalCents).toBe(4001 + n * 7 + (attended ? 7 * 333 : 0));
    }
  });

  it("charges a member for each friend, cents left over going to the first shares", () => {
    const rows = [row("A", 0), row("A", 1), row("A", 2, false), row("B", 0)];
    const s = settle(rows, { courtTotalCents: 10000, shuttleCount: 10, shuttlePriceCents: 100 });
    expect(s.courtShareCents).toBe(2500);
    expect(s.shuttleShareCents).toBe(333); // 1000 / 3 = 333 remainder 1
    const a = s.bills.find((b) => b.memberId === "A")!;
    expect(a.shares.map((x) => x.shuttleCents)).toEqual([334, 333, 0]);
    expect(a.totalCents).toBe(2500 + 334 + 2500 + 333 + 2500);
    expect(s.bills.find((b) => b.memberId === "B")!.totalCents).toBe(2500 + 333);
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
