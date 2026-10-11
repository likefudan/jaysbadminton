import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatDateZh, toPacific } from "../shared/time";
import { MESSAGES } from "./messages";

/**
 * 简体 / 繁體 / English for the member and public pages. The text in the code stays Simplified
 * Chinese and is its own key: t("我的活动") looks it up in messages.ts and falls back to the key.
 * The choice is kept in this browser only; the admin pages stay Simplified Chinese.
 */
export type Lang = "zh-CN" | "zh-TW" | "en";

export const LANGS: { id: Lang; short: string; name: string }[] = [
  { id: "zh-CN", short: "简", name: "简体中文" },
  { id: "zh-TW", short: "繁", name: "繁體中文" },
  { id: "en", short: "EN", name: "English" },
];

const KEY = "lang";
const isLang = (s: string | null): s is Lang => s === "zh-CN" || s === "zh-TW" || s === "en";

/**
 * Before anyone picks: Traditional Chinese for a phone set to it, otherwise Simplified. Phones set to
 * English stay on Simplified too: most of the group reads Chinese on an English-language phone.
 */
function detect(): Lang {
  if (typeof navigator === "undefined") return "zh-CN";
  const first = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  return /^zh-(hant|tw|hk|mo)/.test(first) ? "zh-TW" : "zh-CN";
}

function saved(): Lang | null {
  try {
    const s = localStorage.getItem(KEY);
    return isLang(s) ? s : null;
  } catch {
    return null;
  }
}

let chosen: Lang = saved() ?? detect();
/** What this render is in: the visitor's choice, or Simplified on the admin pages. */
let active: Lang = chosen;
const listeners = new Set<(l: Lang) => void>();

export function setLang(lang: Lang) {
  chosen = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Private mode: the choice holds for this visit.
  }
  listeners.forEach((l) => l(lang));
}

/** The visitor's choice, for the switch. */
export function useLang(): Lang {
  const [l, setL] = useState(chosen);
  useEffect(() => {
    listeners.add(setL);
    return () => void listeners.delete(setL);
  }, []);
  return l;
}

/** Sets the language the page renders in (main.tsx, before rendering the page). */
export function useActiveLang(admin: boolean): Lang {
  const lang = useLang();
  return activate(admin ? "zh-CN" : lang);
}

/** Renders from now on in this language (useActiveLang, and tests). */
export function activate(lang: Lang): Lang {
  active = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  return lang;
}

export const currentLang = () => active;

function lookup(zh: string): string {
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

/** Like t(), for placeholders that are elements (a <strong>, a link). */
export function tx(zh: string, vars: Record<string, ComponentChildren>): ComponentChildren[] {
  return lookup(zh)
    .split(/(\{\w+\})/)
    .map((part) => {
      const k = /^\{(\w+)\}$/.exec(part)?.[1];
      return k && k in vars ? vars[k] : part;
    });
}

let patterns: { re: RegExp; names: string[]; key: string }[] | null = null;

/**
 * A message made elsewhere (the server, a shared form check), translated when it is one we know.
 * Messages with numbers or names in them match a key with placeholders ("用户名最多 {n} 个字").
 */
export function tm(message: string): string {
  if (active === "zh-CN" || !message) return message;
  if (MESSAGES[message]) return t(message);
  patterns ??= Object.keys(MESSAGES)
    .filter((k) => k.includes("{"))
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

/** 周六 / 週六 / Sat for 0 = Sunday. */
export function weekday(n: number): string {
  return (active === "en" ? WEEK_EN : active === "zh-TW" ? WEEK_TW : WEEK_ZH)[n]!;
}

/** "2026年10月6日 周二", or "Tue, Oct 6, 2026"; without the year when withYear is false. */
export function fmtDate(date: string, withYear = true): string {
  if (active === "zh-CN") return formatDateZh(date, withYear);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const w = weekday(new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay());
  if (active === "en") return `${w}, ${MONTH_EN[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
  return `${withYear ? `${y}年` : ""}${m}月${d}日 ${w}`;
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
