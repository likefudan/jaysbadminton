import { afterEach, describe, expect, it } from "vitest";
import { checkUsername } from "../src/shared/rules";
import { eventCardText, siteCardText } from "../src/shared/shareCard";
import { STYLES } from "../src/shared/themes";
import { STATUS_ZH } from "../src/shared/types";
import { activate, fmtDate, t, tm } from "../src/web/i18n";
import { MESSAGES } from "../src/web/messages";

const sources = import.meta.glob("../src/web/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CALL = /\b(?:t|tx|tk)\(\s*"((?:[^"\\]|\\.)*)"/g;
// Pages and parts only the Owner and organizers see stay Chinese (main.tsx renders /admin in 简体).
const ADMIN_ONLY = /pages\/Admin|DeveloperTools|AddressInput|organizers\.ts|messages\.ts|i18n\.ts|site\.ts/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => {
  activate("zh-CN");
});

describe("translations", () => {
  it("has 繁體 and English for every text the pages look up", () => {
    const missing: string[] = [];
    for (const src of Object.values(sources))
      for (const m of src.matchAll(CALL)) {
        const key = JSON.parse(`"${m[1]}"`) as string;
        if (!MESSAGES[key]) missing.push(key);
      }
    expect(missing).toEqual([]);
  });

  it("leaves no Chinese outside t() on the member and public pages", () => {
    const left: string[] = [];
    for (const [file, src] of Object.entries(sources)) {
      if (ADMIN_ONLY.test(file)) continue;
      const code = src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
        .replace(CALL, "");
      for (const line of code.split("\n")) if (/[一-鿿]/.test(line)) left.push(`${file}: ${line.trim()}`);
    }
    expect(left).toEqual([]);
  });

  it("keeps every placeholder in both translations", () => {
    for (const [key, m] of Object.entries(MESSAGES)) {
      expect(placeholders(m.tw), key).toEqual(placeholders(key));
      if (m.en) expect(placeholders(m.en), key).toEqual(placeholders(key));
    }
  });

  it("covers the words shared code hands to the pages", () => {
    const shared = [
      ...Object.values(STATUS_ZH),
      ...STYLES.flatMap((s) => [s.name, ...s.accents.map((a) => a.name)]),
      ...siteCardText("").lines,
      siteCardText("").hint,
    ];
    for (const status of ["open", "closed"] as const)
      shared.push(eventCardText("", { status, date: "2026-10-06" } as never).hint);
    shared.push(eventCardText("", { status: "cancelled", date: "2026-10-06" } as never).lines[0]!); // 本场已取消
    expect(shared.filter((s) => s && !MESSAGES[s])).toEqual([]);
  });
});

describe("t / tm", () => {
  it("falls back to the Chinese and fills placeholders", () => {
    expect(t("最多 {n} 个朋友", { n: 3 })).toBe("最多 3 个朋友");
    activate("en");
    expect(t("最多 {n} 个朋友", { n: 3 })).toBe("Up to 3 friends");
    expect(t("没有这条")).toBe("没有这条");
    activate("zh-TW");
    expect(t("我的活动")).toBe("我的活動");
  });

  it("translates server and form-check messages, numbers included", () => {
    activate("en");
    expect(tm(checkUsername("a".repeat(30))!)).toBe("Usernames can be at most 20 characters");
    expect(tm("找不到这个活动")).toBe("Event not found");
    expect(tm("服务器说了别的")).toBe("服务器说了别的");
    expect(tm("请填写邮箱 或 微信名")).toBe("请填写邮箱 或 微信名");
  });

  it("writes dates the way each language does", () => {
    expect(fmtDate("2026-10-06")).toBe("2026年10月6日 周二");
    activate("zh-TW");
    expect(fmtDate("2026-10-06", false)).toBe("10月6日 週二");
    activate("en");
    expect(fmtDate("2026-10-06")).toBe("Tue, Oct 6, 2026");
  });
});
