import { describe, expect, it } from "vitest";
import {
  codeName,
  codeOf,
  nextEventNumber,
  yearCodeOf,
  noteName,
  parsePaymentCode,
  paymentCode,
} from "../src/worker/paymentCode";

describe("payment codes", () => {
  it("builds lowercase notes with pinyin names", () => {
    expect(paymentCode("小明", "jbm20261007", "M002")).toBe("xiaoming-jbm20261007-m002");
    expect(paymentCode("Alice Wang", "jbm20261007b", "M003")).toBe("alice_wang-jbm20261007b-m003");
    expect(paymentCode("Bob", "jbm20261007", "M1234")).toBe("bob-jbm20261007-m1234");
  });

  it("normalises names", () => {
    expect(noteName("Ming明")).toBe("mingming");
    expect(noteName("李-A")).toBe("li_a");
    expect(noteName("🏸张三")).toBe("zhangsan");
    expect(noteName("🏸🏸")).toBe("member");
  });

  it("parses codes from notes, ignoring case and stray spaces", () => {
    expect(parsePaymentCode("xiaoming-jbm20261007-m002")).toEqual({
      name: "xiaoming",
      number: "jbm20261007",
      memberId: "M002",
    });
    expect(parsePaymentCode("Thanks! XiaoMing-JBM20261007B-M002 🏸")).toEqual({
      name: "xiaoming",
      number: "jbm20261007b",
      memberId: "M002",
    });
    expect(parsePaymentCode("alice_wang - jbm 20261007 - m2")).toEqual({
      name: "alice_wang",
      number: "jbm20261007",
      memberId: "M002",
    });
    expect(parsePaymentCode("jbm20261007-m002")).toMatchObject({ name: null, memberId: "M002" });
  });

  it("ignores unrelated notes", () => {
    expect(parsePaymentCode("BM1007-M002")).toBeNull();
    expect(parsePaymentCode("Milktea9/27")).toBeNull();
    expect(parsePaymentCode("rent 20261007")).toBeNull();
    expect(codeName("alice_wang-jbm20261007b-m003")).toBe("alice_wang");
  });

  it("hands out each day's event numbers once, skipping any already taken", () => {
    expect(nextEventNumber("2026-10-07", new Set())).toBe("jbm20261007");
    expect(nextEventNumber("2026-10-07", new Set(["jbm20261007"]))).toBe("jbm20261007b");
    // The first letter nobody has used, whatever order the others were taken in.
    expect(nextEventNumber("2026-10-07", new Set(["jbm20261007", "jbm20261007c"]))).toBe("jbm20261007b");
    expect(nextEventNumber("2026-10-07", new Set(["jbm20261007", "jbm20261007b"]))).toBe("jbm20261007c");
    const full = new Set(["", ..."bcdefghijklmnopqrstuvwxyz"].map((s) => `jbm20261007${s}`));
    expect(nextEventNumber("2026-10-07", full)).toBeNull();
    expect(codeOf("jbm20261007")).toBe("1007");
    expect(codeOf("jbm20261007b")).toBe("1007B");
    expect(yearCodeOf("jbm20271007")).toBe("27-1007");
    expect(yearCodeOf("jbm20271007b")).toBe("27-1007B");
  });
});

describe("eventLabel", () => {
  it("names the day's second event by the letter, with or without the year in the code", async () => {
    const { eventLabel } = await import("../src/worker/inbound");
    expect(eventLabel("2026-10-06", "1006")).not.toContain("场");
    expect(eventLabel("2026-10-06", "1006B")).toContain("第2场");
    expect(eventLabel("2026-11-05", "26-1105")).not.toContain("场");
    expect(eventLabel("2026-11-05", "26-1105C")).toContain("第3场");
  });
});
