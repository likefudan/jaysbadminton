import { describe, expect, it } from "vitest";
import { eventCardText, siteCardText } from "../src/shared/shareCard";
import type { EventSummary } from "../src/shared/types";

const event: EventSummary = {
  id: 1,
  code: "AB12",
  date: "2026-10-06",
  startTime: "19:00",
  endTime: "21:00",
  location: "Bay Badminton Center",
  address: "",
  title: "HappyTuesday",
  deadlineAt: "2026-10-06T19:00:00.000Z",
  status: "open",
  headcount: 8,
};

describe("分享名片 text", () => {
  it("links the home page with the tagline", () => {
    expect(siteCardText("https://example.com")).toEqual({
      heading: "",
      lines: ["报名、结算、付款，一个链接搞定。"],
      hint: "扫码查看活动、报名",
      url: "https://example.com/",
    });
  });

  it("shows when and where for an event, never who", () => {
    const t = eventCardText("https://example.com", event);
    expect(t).toEqual({
      heading: "HappyTuesday",
      lines: ["10月6日 周二 19:00–21:00", "Bay Badminton Center"],
      hint: "扫码报名",
      url: "https://example.com/e/AB12",
    });
  });

  it("marks a cancelled event and shows no heading when the event has no title", () => {
    const t = eventCardText("https://example.com", { ...event, title: "", status: "cancelled" });
    expect(t.heading).toBe("");
    expect(t.lines[0]).toBe("本场已取消");
    expect(t.hint).toBe("扫码查看活动");
  });
});
