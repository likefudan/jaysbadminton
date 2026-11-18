// Validation rules shared by the Worker and the front end so both show the same messages.

export const USERNAME_MAX = 20;
export const NICKNAME_MAX = 30;
export const MESSAGE_MAX = 200;
export const PASSWORD_MIN = 8;

export function checkUsername(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "请填写用户名";
  if ([...name].length > USERNAME_MAX) return `用户名最多 ${USERNAME_MAX} 个字`;
  if (/\s/.test(name)) return "用户名不能包含空格";
  return checkNameChars(name);
}

/**
 * What a name may be made of (Ke Li 2026-11-18): 中文, English letters, digits, spaces and
 * . - _ ( ), starting with 中文, a letter or a digit, so no emoji, fancy letters or a name of only
 * dots. （） typed by a Chinese keyboard count as ( ). Names saved before this stay as they are;
 * it is checked only when a name is typed in new or changed. `name` comes trimmed, and not empty.
 */
export function checkNameChars(name: string): string | null {
  if (!/^[\p{Script=Han}A-Za-z0-9 ._\-()（）]*$/u.test(name)) return NAME_CHARS_ERROR;
  if (!/^[\p{Script=Han}A-Za-z0-9]/u.test(name)) return "名字要以中文、英文或数字开头";
  return null;
}
export const NAME_CHARS_ERROR = "名字只能用中文、英文、数字和 . - _ ( )";

/** A friend's name on a sign-up: may be blank (shown as "<member>的朋友<n>"). */
export function checkFriendName(raw: string): string | null {
  const name = raw.trim();
  return name ? checkNameChars(name) : null;
}

export function checkNickname(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "请填写微信名";
  if ([...name].length > NICKNAME_MAX) return `微信名最多 ${NICKNAME_MAX} 个字`;
  return null;
}

export const EMAIL_MAX = 100;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

/** An email address someone types in (registering, 找回链接, 个人信息). */
export function checkEmail(raw: string): string | null {
  const email = raw.trim();
  if (!email) return "请填写邮箱";
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return "邮箱格式不对";
  return null;
}

/** 给群主的留言: optional. */
export function checkMessage(raw: string): string | null {
  return [...raw.trim()].length > MESSAGE_MAX ? `留言最多 ${MESSAGE_MAX} 个字` : null;
}

export function checkPassword(raw: string): string | null {
  if (raw.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  return null;
}

/** The languages the site speaks (the page's switch, and 桌面图标名称). */
export const SITE_LANGS = ["zh-CN", "zh-TW", "en"] as const;
export type SiteLang = (typeof SITE_LANGS)[number];
export const isSiteLang = (s: string | null | undefined): s is SiteLang =>
  (SITE_LANGS as readonly string[]).includes(s ?? "");

/** 桌面图标名称: about what a launcher fits under an icon (Android shows ~12 letters or ~6 汉字). */
export const APP_NAME_MAX = 12;
/** 桌面图标名称 in each language, "" where not set. */
export type AppNames = Record<SiteLang, string>;

/**
 * The name the icon gets in `lang` (Ke Li 2026-11-04): that language's 桌面图标名称, else
 * Simplified's, else the site title.
 */
export const appNameFor = (names: AppNames | null, lang: SiteLang, siteTitle: string): string =>
  names?.[lang] || names?.["zh-CN"] || siteTitle;

/**
 * 入群不需要审核: a bot could otherwise fill the member list, so after this many automatic joins in a
 * day, newcomers wait in 待审核 again until the day has passed. The Owner and admins set the number
 * in 设置 (Ke Li 2026-11-04), 1–999.
 */
export const DEFAULT_AUTO_JOINS_PER_DAY = 20;
export const MAX_AUTO_JOINS_PER_DAY = 999;

/** The 每天最多自动通过 number as typed: an error, or null when it is a whole number 1–999. */
export function checkAutoJoinCap(n: number): string | null {
  return Number.isInteger(n) && n >= 1 && n <= MAX_AUTO_JOINS_PER_DAY
    ? null
    : `每天最多自动通过的人数请填 1–${MAX_AUTO_JOINS_PER_DAY}`;
}

/** 点赞 (Ke Li 2026-11-11): from the end of the event for this many hours, as 设置 says. */
export const DEFAULT_LIKE_HOURS = 24;
export const LIKE_HOURS_MAX = 720;
/** …each member may like this share of the people who played (in %), as 设置 says. */
export const DEFAULT_LIKE_PCT = 15;
/**
 * How many likes each may give where `players` played (them included): pct of them rounded up
 * (Ke Li), at least 1, never more than the others there (nobody likes themselves).
 */
export const likeCap = (players: number, pct: number) =>
  Math.max(1, Math.min(Math.ceil((players * pct) / 100), players - 1));

/**
 * 我的活动 page's 「你好，名字」 (Ke Li 2026-11-12, an admin setting): the big title as before, a
 * small line beside 我的活动 / 个人信息, or none.
 */
export type Greeting = "big" | "small" | "none";
export const GREETINGS: readonly Greeting[] = ["big", "small", "none"];
export const normalizeGreeting = (v: string | null | undefined): Greeting =>
  GREETINGS.includes(v as Greeting) ? (v as Greeting) : "big";
export const GREETING_NAME: Record<Greeting, string> = { big: "大标题", small: "小字", none: "不显示" };
