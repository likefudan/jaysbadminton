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
    expect(s.shuttleShareCents).toBe(273); // 60 / 22 = 2.7272… rounded up
    expect(s.bills[0]!.totalCents).toBe(1273);
    expect(s.bills[23]!.totalCents).toBe(1000);
  });

  it("charges a member for each friend, with each share rounded up separately", () => {
    const rows = [row("A", 0), row("A", 1), row("A", 2, false), row("B", 0)];
    const s = settle(rows, { courtTotalCents: 10000, shuttleCount: 10, shuttlePriceCents: 100 });
    expect(s.courtShareCents).toBe(2500);
    expect(s.shuttleShareCents).toBe(334); // 1000 / 3
    const a = s.bills.find((b) => b.memberId === "A")!;
    expect(a.totalCents).toBe(2500 + 334 + 2500 + 334 + 2500);
    expect(s.totalCents).toBeGreaterThanOrEqual(10000 + 1000); // never under-collects
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
