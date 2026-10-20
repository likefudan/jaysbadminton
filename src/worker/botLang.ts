import { dollars } from "../shared/settle";
import { formatDateZh, toPacific } from "../shared/time";
import type { Env } from "./env";
import { BOT_MESSAGES } from "./botMessages";

/**
 * 简体 / 繁體 / English for the Telegram bot. Each chat picks its own (「语言」 in the bot), kept in
 * telegram_langs and independent of the web pages; a chat that never picked reads 简体中文. Like
 * the pages, the text in the code stays Simplified Chinese and is its own key: bt(l, zh, vars)
 * looks it up in botMessages.ts. Texts to paste into the WeChat group stay Simplified Chinese.
 */
export type BotLang = "zh-CN" | "zh-TW" | "en";

/** A message for one chat, made once its language is known. */
export type BotText = (l: BotLang) => string | Promise<string>;

export const BOT_LANGS: { id: BotLang; name: string }[] = [
  { id: "zh-CN", name: "简体中文" },
  { id: "zh-TW", name: "繁體中文" },
  { id: "en", name: "English" },
];

export const isBotLang = (s: unknown): s is BotLang => s === "zh-CN" || s === "zh-TW" || s === "en";

/** The text in `l`, with {name} placeholders filled in. Unknown keys stay as they are. */
export function bt(l: BotLang, zh: string, vars?: Record<string, string | number>): string {
  const m = l === "zh-CN" ? undefined : BOT_MESSAGES[zh];
  const s = m ? (l === "en" ? m.en : m.tw) : zh;
  return vars ? s.replace(/\{(\w+)\}/g, (k0: string, k: string) => (k in vars ? String(vars[k]) : k0)) : s;
}

const WEEK_TW = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026年10月6日 周二", "2026年10月6日 週二" or "Tue, Oct 6, 2026"; without the year when withYear is false. */
export function botDate(l: BotLang, date: string, withYear = true): string {
  if (l === "zh-CN") return formatDateZh(date, withYear);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const n = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  if (l === "en") return `${WEEK_EN[n]}, ${MONTH_EN[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
  return `${withYear ? `${y}年` : ""}${m}月${d}日 ${WEEK_TW[n]}`;
}

/** "10月5日 周一 20:00" for a UTC instant, in Pacific time. */
export function botInstant(l: BotLang, iso: string): string {
  const p = toPacific(iso);
  return `${botDate(l, p.date, false)} ${p.time}`;
}

/** "$12.50": money in a message. */
export const usd = (cents: number) => `$${dollars(cents)}`;

/** Items joined the way the language lists them: 「，」 in Chinese, ", " in English. */
export const botList = (l: BotLang, items: string[]) => items.join(l === "en" ? ", " : "，");

export async function chatLang(env: Env, chatId: string): Promise<BotLang> {
  const r = await env.DB.prepare("SELECT lang FROM telegram_langs WHERE chat_id = ?")
    .bind(chatId)
    .first<{ lang: string }>();
  return isBotLang(r?.lang) ? r.lang : "zh-CN";
}

export async function setChatLang(env: Env, chatId: string, lang: BotLang): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO telegram_langs (chat_id, lang) VALUES (?, ?) ON CONFLICT (chat_id) DO UPDATE SET lang = excluded.lang",
  )
    .bind(chatId, lang)
    .run();
}

/**
 * A chat connecting for the first time starts in Traditional Chinese when Telegram is set to it,
 * otherwise Simplified (English Telegram too, as on the pages: most of the group reads Chinese).
 * A chat that already picked keeps its choice.
 */
export async function initChatLang(env: Env, chatId: string, telegramLang: string | undefined): Promise<void> {
  const lang: BotLang = /^zh-(hant|tw|hk|mo)/i.test(telegramLang ?? "") ? "zh-TW" : "zh-CN";
  await env.DB.prepare("INSERT OR IGNORE INTO telegram_langs (chat_id, lang) VALUES (?, ?)").bind(chatId, lang).run();
}

let patterns: { re: RegExp; names: string[]; key: string }[] | null = null;

/**
 * A message made and kept elsewhere in Chinese (a 待确认 reason), translated when it is one we know.
 * Ones with names or numbers in them match a key with placeholders; what fills them stays as it is.
 */
export function btm(l: BotLang, zh: string): string {
  if (l === "zh-CN" || !zh) return zh;
  if (BOT_MESSAGES[zh]) return bt(l, zh);
  patterns ??= Object.keys(BOT_MESSAGES)
    .filter((k) => k.includes("{"))
    .map((key) => {
      const names: string[] = [];
      const src = key
        .split(/(\{\w+\})/)
        .map((part) => {
          const k = /^\{(\w+)\}$/.exec(part)?.[1];
          if (!k) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          names.push(k);
          return "(.+?)";
        })
        .join("");
      return { re: new RegExp(`^${src}$`), names, key };
    });
  for (const p of patterns) {
    const m = p.re.exec(zh);
    if (m) return bt(l, p.key, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]!])));
  }
  return zh;
}
