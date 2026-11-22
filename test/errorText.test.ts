/// <reference types="vite/client" />
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ERROR_CATALOG, errorText, UNTRANSLATED_EN } from "../src/worker/errorText";
import { ERROR_MESSAGES } from "../src/worker/errorMessages";
import { ADMIN_MESSAGES } from "../src/web/adminMessages";
import { MEMBER_MESSAGES } from "../src/web/messages";

const sources = import.meta.glob(["../src/worker/**/*.ts", "../src/shared/**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const CJK = /[\u3400-\u9fff]/;

/**
 * Every Chinese text inside badRequest(…), new HttpError(…) and ek(…), with where it is. A template's
 * ${…} becomes "X1" so the text can be looked up as it would come out; a template with Chinese inside
 * its ${…} is two messages in one, which no key can match whole, and is reported as such.
 */
function errorTexts(): { where: string; text: string; nested: boolean }[] {
  const out: { where: string; text: string; nested: boolean }[] = [];
  for (const [file, raw] of Object.entries(sources)) {
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    for (const call of src.matchAll(/\b(?:badRequest|HttpError|ek)\(/g)) {
      let i = call.index + call[0].length;
      let depth = 1;
      const line = src.slice(0, call.index).split("\n").length;
      // Reads one literal from src[i] (a quote or backtick); returns its text and where it ends.
      const literal = (start: number): { text: string; end: number; nested: boolean } => {
        const q = src[start]!;
        let j = start + 1;
        let text = "";
        let nested = false;
        while (j < src.length && src[j] !== q) {
          if (src[j] === "\\") {
            const e = src[j + 1]!;
            text += e === "n" ? "\n" : e;
            j += 2;
          } else if (q === "`" && src[j] === "$" && src[j + 1] === "{") {
            let d = 1;
            j += 2;
            while (j < src.length && d > 0) {
              const c = src[j]!;
              if (c === '"' || c === "'" || c === "`") {
                const inner = literal(j);
                if (CJK.test(inner.text)) nested = true;
                j = inner.end + 1;
                continue;
              }
              if (c === "{") d++;
              else if (c === "}") d--;
              j++;
            }
            text += "X1";
          } else text += src[j++];
        }
        return { text, end: j, nested };
      };
      while (i < src.length && depth > 0) {
        const c = src[i]!;
        if (c === '"' || c === "'" || c === "`") {
          const lit = literal(i);
          if (CJK.test(lit.text)) out.push({ where: `${file}:${line}`, text: lit.text, nested: lit.nested });
          i = lit.end + 1;
          continue;
        }
        if (c === "/" && src[i + 1] === "/") {
          i = src.indexOf("\n", i);
          continue;
        }
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        i++;
      }
    }
  }
  return out;
}

describe("error messages in the page's language", () => {
  const found = errorTexts();

  it("finds the errors (the scan itself works)", () => {
    expect(found.length).toBeGreaterThan(300);
    expect(found.map((f) => f.text)).toContain("这条记录已经被删掉了");
  });

  it("has English for every error the Worker answers with", () => {
    const missing = found
      .filter((f) => !f.nested)
      .filter((f) => {
        const en = errorText("en", f.text);
        return en === UNTRANSLATED_EN || CJK.test(en);
      })
      .map((f) => `${f.where}  ${f.text}`);
    expect(missing).toEqual([]);
  });

  it("keeps each error one whole message (no Chinese inside a template's placeholders)", () => {
    expect(found.filter((f) => f.nested).map((f) => `${f.where}  ${f.text}`)).toEqual([]);
  });

  it("adds no key the pages' own texts already have, and keeps every placeholder", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(Object.keys(ERROR_MESSAGES).filter((k) => MEMBER_MESSAGES[k] || ADMIN_MESSAGES[k])).toEqual([]);
    for (const [key, m] of Object.entries(ERROR_MESSAGES)) {
      expect(placeholders(m.tw), key).toEqual(placeholders(key));
      expect(placeholders(m.en), key).toEqual(placeholders(key));
      expect(CJK.test(m.en), key).toBe(false);
    }
  });

  it("translates by pattern, names included, and never answers English with Chinese", () => {
    expect(errorText("en", "这条记录已经被删掉了")).toBe(ERROR_CATALOG.这条记录已经被删掉了!.en);
    expect(errorText("en", "找不到这个活动")).toBe("Event not found");
    expect(errorText("zh-TW", "找不到这个活动")).toBe("找不到這個活動");
    expect(errorText("zh-CN", "找不到这个活动")).toBe("找不到这个活动");
    expect(errorText("en", "账号 小明 已经有人填过了")).toBe("Account 小明 has already been added");
    expect(errorText("en", "服务器说了别的")).toBe(UNTRANSLATED_EN);
    expect(errorText("zh-TW", "服务器说了别的")).toBe("服务器说了别的");
  });

  it("answers the API in the language the page asked for", async () => {
    const ask = (lang?: string) =>
      exports.default
        .fetch("https://example.com/api/nothing-here", { headers: lang ? { "X-Lang": lang } : {} })
        .then((r) => r.json() as Promise<{ error: { message: string } }>);
    expect((await ask()).error.message).toBe("找不到这个地址");
    expect((await ask("zh-CN")).error.message).toBe("找不到这个地址");
    expect((await ask("en")).error.message).toBe(errorText("en", "找不到这个地址"));
    expect((await ask("en")).error.message).not.toMatch(CJK);
    expect((await ask("zh-TW")).error.message).toBe(errorText("zh-TW", "找不到这个地址"));
  });
});
