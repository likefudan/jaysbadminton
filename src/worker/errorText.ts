import { isSiteLang, type SiteLang } from "../shared/rules";
import { type Catalog, compilePatterns, fill, matchMessage, type Pattern } from "../shared/translate";
import { ADMIN_MESSAGES } from "../web/adminMessages";
import { MEMBER_MESSAGES } from "../web/messages";
import { ERROR_MESSAGES } from "./errorMessages";

/**
 * The errors the API answers with, in the language the page is shown in (Ke Li 2026-11-22: an English
 * page showed 「这条记录已经被删掉了」). The code keeps writing them in Simplified Chinese; the page says
 * which language it reads in the X-Lang header (src/web/api.ts), and the answer is translated here from
 * the pages' own texts plus errorMessages.ts. test/errorText.test.ts checks every error has one.
 */
export const ERROR_CATALOG: Catalog = { ...MEMBER_MESSAGES, ...ADMIN_MESSAGES, ...ERROR_MESSAGES };

let patterns: Pattern[] | null = null;

/** What English shows for an error nobody translated yet: English still, never Chinese (Ke Li). */
export const UNTRANSLATED_EN = "Something went wrong. Please try again.";

/** The language a request asked for; Simplified for a page from before this (no header). */
export const requestLang = (header: string | undefined | null): SiteLang => (isSiteLang(header) ? header : "zh-CN");

/**
 * The message in that language. 繁體 falls back to the Simplified (readable); English to a plain
 * English sentence, and the Chinese goes to the log so it can be added.
 */
export function errorText(lang: SiteLang, message: string): string {
  if (lang === "zh-CN" || !message) return message;
  patterns ??= compilePatterns(ERROR_CATALOG);
  const m = matchMessage(ERROR_CATALOG, patterns, message);
  if (m) {
    const s = ERROR_CATALOG[m.key]!;
    return fill(lang === "en" ? s.en : s.tw, m.vars);
  }
  if (lang === "zh-TW" || !/[㐀-鿿]/.test(message)) return message;
  console.warn("untranslated error:", message);
  return UNTRANSLATED_EN;
}
