import { formatDateZh, toPacific } from "../shared/time";
import { MESSAGES } from "./messages";

/**
 * 简体 / 繁體 / English for every page, the admin pages included (Ke Li 2026-11-04). The text in the code stays Simplified
 * Chinese and is its own key: t("我的活动") looks it up in messages.ts and falls back to the key.
 * The choice is kept in this browser only.
 *
 * Nothing here needs preact or the DOM types (tests type-check it with the Worker's); the hooks
 * and tx() are in i18n.ts, which is what the pages import.
 */
export type Lang = "zh-CN" | "zh-TW" | "en";

export const LANGS: { id: Lang; name: string }[] = [
  { id: "zh-CN", name: "简体中文" },
  { id: "zh-TW", name: "繁體中文" },
  { id: "en", name: "English" },
];

export const LANG_KEY = "lang";

// The browser globals this uses, typed loosely: they are absent in the Worker's types.
const g = globalThis as {
  localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
  navigator?: { languages?: readonly string[]; language?: string };
  document?: { documentElement: { lang: string } };
};
export const isLang = (s: string | null): s is Lang => s === "zh-CN" || s === "zh-TW" || s === "en";

/**
 * Before anyone picks: Traditional Chinese for a phone set to it, otherwise Simplified. Phones set to
 * English stay on Simplified too: most of the group reads Chinese on an English-language phone.
 */
function detect(): Lang {
  const first = (g.navigator?.languages?.[0] ?? g.navigator?.language ?? "").toLowerCase();
  return /^zh-(hant|tw|hk|mo)/.test(first) ? "zh-TW" : "zh-CN";
}

function saved(): Lang | null {
  try {
    const s = g.localStorage?.getItem(LANG_KEY) ?? null;
    return isLang(s) ? s : null;
  } catch {
    return null;
  }
}

let chosen: Lang = saved() ?? detect();

/** The Owner's, admins' and organizers' pages. */
export const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");
/** What this render is in: the visitor's choice. */
let active: Lang = chosen;
export const listeners = new Set<(l: Lang) => void>();
export const chosenLang = () => chosen;

/** The visitor picks a language; save = false for a choice already saved by another tab. */
export function setLang(lang: Lang, save = true) {
  chosen = lang;
  if (save)
    try {
      g.localStorage?.setItem(LANG_KEY, lang);
    } catch {
      // Private mode: the choice holds for this visit.
    }
  listeners.forEach((l) => l(lang));
}

/** Renders from now on in this language (useActiveLang in i18n.ts, and tests). */
export function activate(lang: Lang): Lang {
  active = lang;
  if (g.document) g.document.documentElement.lang = lang;
  return lang;
}

export const currentLang = () => active;

export function lookup(zh: string): string {
  if (active === "zh-CN") return zh;
  const m = MESSAGES[zh];
  if (!m) return zh;
  return active === "en" ? m.en : m.tw;
}

/** Marks text kept as data and translated where it is shown, with t(). */
export const tk = (zh: string) => zh;

/** The text in the current language, with {name} placeholders filled in. */
export function t(zh: string, vars?: Record<string, string | number>): string {
  const s = lookup(zh);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

let patterns: { re: RegExp; names: string[]; key: string }[] | null = null;

/**
 * A message made elsewhere (the server, a shared form check), translated when it is one we know.
 * Messages with numbers or names in them match a key with placeholders ("用户名最多 {n} 个字").
 */
export function tm(message: string): string {
  if (active === "zh-CN" || !message) return message;
  if (MESSAGES[message]) return t(message);
  // Only keys with enough words of their own: "{a} 或 {b}" would match any message with 或 in it.
  patterns ??= Object.keys(MESSAGES)
    .filter((k) => k.includes("{") && k.replace(/\{\w+\}/g, "").trim().length >= 4)
    .map((key) => {
      const names: string[] = [];
      const src = key
        .split(/(\{\w+\})/)
        .map((part) => {
          const k = /^\{(\w+)\}$/.exec(part)?.[1];
          if (k) {
            names.push(k);
            return "(.+?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      return { re: new RegExp(`^${src}$`), names, key };
    });
  for (const p of patterns) {
    const m = p.re.exec(message);
    if (m) return t(p.key, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]!])));
  }
  return message;
}

const WEEK_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEK_TW = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 周六 / 週六 / Sat for a YYYY-MM-DD date. */
export function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return weekday(new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay());
}

/** 周六 / 週六 / Sat for 0 = Sunday. */
export function weekday(n: number): string {
  return (active === "en" ? WEEK_EN : active === "zh-TW" ? WEEK_TW : WEEK_ZH)[n]!;
}

/** "2026年10月6日 周二", or "Tue, Oct 6, 2026"; without the year when withYear is false. */
export function fmtDate(date: string, withYear = true): string {
  if (active === "zh-CN") return formatDateZh(date, withYear);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const w = weekdayOf(date);
  if (active === "en") return `${w}, ${MONTH_EN[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
  return `${withYear ? `${y}年` : ""}${m}月${d}日 ${w}`;
}

/** "2026年10月6日", or "Oct 6, 2026": a date without its weekday. */
export function fmtDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return active === "en" ? `${MONTH_EN[m - 1]} ${d}, ${y}` : `${y}年${m}月${d}日`;
}

/** "10月5日 周一 20:00" for a UTC instant, in Pacific time. */
export function fmtInstant(iso: string): string {
  const p = toPacific(iso);
  return `${fmtDate(p.date, false)} ${p.time}`;
}

/** "9月", or "Sep" in English. */
export function month(n: number): string {
  return active === "en" ? MONTH_EN[n - 1]! : `${n}月`;
}

/** Month and year labels made in Chinese by shared code ("9月", "2026年9月", "2026年"). */
export function dateText(zh: string): string {
  if (active !== "en") return zh;
  let m = /^(\d+)月$/.exec(zh);
  if (m) return MONTH_EN[Number(m[1]) - 1]!;
  m = /^(\d{4})年(\d+)月$/.exec(zh);
  if (m) return `${MONTH_EN[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{4})年$/.exec(zh);
  if (m) return m[1]!;
  return zh;
}
