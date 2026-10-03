import { describe, expect, it } from "vitest";
import { codeName, noteName, parsePaymentCode, paymentCode } from "../src/worker/paymentCode";

describe("payment codes", () => {
  it("builds lowercase notes with pinyin names", () => {
    expect(paymentCode("小明", "2026-10-07", "1007", "M002")).toBe("xiaoming-jbm20261007-m002");
    expect(paymentCode("Alice Wang", "2026-10-07", "1007B", "M003")).toBe("alice_wang-jbm20261007b-m003");
    expect(paymentCode("Bob", "2026-10-07", "1007", "M1234")).toBe("bob-jbm20261007-m1234");
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
      date: "2026-10-07",
      eventCode: "1007",
      memberId: "M002",
    });
    expect(parsePaymentCode("Thanks! XiaoMing-JBM20261007B-M002 🏸")).toEqual({
      name: "xiaoming",
      date: "2026-10-07",
      eventCode: "1007B",
      memberId: "M002",
    });
    expect(parsePaymentCode("alice_wang - jbm 20261007 - m2")).toEqual({
      name: "alice_wang",
      date: "2026-10-07",
      eventCode: "1007",
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
});
