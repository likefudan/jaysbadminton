import { describe, expect, it } from "vitest";
import { addMonths, bucketTitle, niceScale, rangeStart, summarize } from "../src/shared/spending";
import type { SpendEntry } from "../src/shared/types";

const e = (date: string, cents: number, attended = true): SpendEntry => ({
  date,
  title: "",
  location: "Gym",
  cents,
  attended,
});
const TODAY = "2026-10-02"; // a Friday

describe("我的统计 ranges", () => {
  const history = [
    e("2024-03-05", 1000),
    e("2026-01-10", 1500),
    e("2026-09-01", 2000, false),
    e("2026-09-29", 2500),
    e("2026-10-02", 1200),
  ];

  it("starts each range where the member expects", () => {
    expect(rangeStart("7D", TODAY, history)).toBe("2026-09-26");
    expect(rangeStart("30D", TODAY, history)).toBe("2026-09-03");
    expect(rangeStart("3M", TODAY, history)).toBe("2026-07-03");
    expect(rangeStart("1Y", TODAY, history)).toBe("2025-10-03");
    expect(rangeStart("YTD", TODAY, history)).toBe("2026-01-01");
    expect(rangeStart("ALL", TODAY, history)).toBe("2024-03-05");
    expect(rangeStart("ALL", TODAY, [])).toBe(TODAY);
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("counts visits, spending and the average for the range only", () => {
    const ytd = summarize(history, "YTD", TODAY);
    expect(ytd).toMatchObject({ count: 3, cents: 7200, avgCents: 2400, unit: "month" }); // the absent one is billed, not counted
    expect(ytd.buckets.map((b) => b.label)).toEqual([
      "1月",
      "2月",
      "3月",
      "4月",
      "5月",
      "6月",
      "7月",
      "8月",
      "9月",
      "10月",
    ]);
    expect(ytd.buckets[8]).toMatchObject({ start: "2026-09-01", end: "2026-09-30", cents: 4500, count: 1 });
    expect(ytd.buckets[9]).toMatchObject({ start: "2026-10-01", end: TODAY, cents: 1200 });

    const week = summarize(history, "7D", TODAY);
    expect(week).toMatchObject({ unit: "day", count: 2, cents: 3700 });
    expect(week.buckets).toHaveLength(7);
    expect(week.buckets.map((b) => b.label)[0]).toBe("9/26");

    expect(summarize(history, "30D", TODAY)).toMatchObject({ unit: "week", count: 2, cents: 3700 });
    // Weeks start on Monday and are clipped to the range: 9/3 (Thu) … 9/6 first.
    expect(summarize(history, "30D", TODAY).buckets[0]).toMatchObject({ start: "2026-09-03", end: "2026-09-06" });
  });

  it("an empty range has no average, and ALL spans the years", () => {
    expect(summarize([e("2025-01-01", 500)], "30D", TODAY)).toMatchObject({
      count: 0,
      cents: 0,
      avgCents: null,
      entries: [],
    });
    const all = summarize(history, "ALL", TODAY);
    expect(all).toMatchObject({ unit: "month", count: 4, cents: 8200 });
    expect(all.buckets[0]).toMatchObject({ start: "2024-03-05", label: "3月" });
    expect(all.buckets.find((b) => b.start === "2025-01-01")!.label).toBe("2025"); // the year turns over
    expect(summarize([e("2020-01-01", 500)], "ALL", TODAY).unit).toBe("year");
  });

  it("picks a clean axis and readable column titles", () => {
    expect(niceScale(4500)).toEqual({ top: 6000, step: 2000 });
    expect(niceScale(500)).toEqual({ top: 600, step: 200 });
    expect(niceScale(0)).toEqual({ top: 1000, step: 500 });
    const ytd = summarize(history, "YTD", TODAY);
    expect(bucketTitle(ytd.buckets[8]!, "month")).toBe("2026年9月");
    expect(bucketTitle(summarize(history, "30D", TODAY).buckets[1]!, "week")).toBe("9/7–9/13");
  });
});
