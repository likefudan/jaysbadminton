import { describe, expect, it } from "vitest";
import { formatDateZh, formatInstantZh, pacificToUtc, toPacific } from "../src/shared/time";

describe("Pacific time helpers", () => {
  it("converts summer (PDT, UTC-7) and winter (PST, UTC-8) wall times", () => {
    expect(pacificToUtc("2026-10-06", "19:00")).toBe("2026-10-07T02:00:00.000Z");
    expect(pacificToUtc("2026-12-08", "19:00")).toBe("2026-12-09T03:00:00.000Z");
  });

  it("round-trips through toPacific", () => {
    expect(toPacific("2026-10-07T02:00:00.000Z")).toEqual({ date: "2026-10-06", time: "19:00", weekday: 2 });
  });

  it("handles the day daylight saving ends (Nov 1 2026)", () => {
    expect(toPacific(pacificToUtc("2026-11-01", "20:00")).time).toBe("20:00");
  });

  it("formats in Chinese", () => {
    expect(formatDateZh("2026-10-06")).toBe("2026年10月6日 周二");
    expect(formatDateZh("2026-10-06", false)).toBe("10月6日 周二");
    expect(formatInstantZh("2026-10-06T03:00:00.000Z")).toBe("10月5日 周一 20:00");
  });
});
