import { SITE_LANGS, type AppNames, type SiteLang } from "../shared/rules";
import { getSettings } from "./db";
import type { Env } from "./env";
import { normalizeTheme, type ThemeId } from "../shared/themes";

export const DEFAULT_SITE_TITLE = "Jay's 羽毛球";
export const SITE_TITLE_MAX = 30;

export async function siteTitle(env: Env): Promise<string> {
  return titleFrom(await getSettings(env.DB, ["site_title"]), env);
}

const titleFrom = (s: Record<string, string>, env: Env) => s.site_title || env.SITE_NAME || DEFAULT_SITE_TITLE;

/** Where each language's 桌面图标名称 is kept: Simplified under the plain key. */
export const appNameKey = (lang: SiteLang) => (lang === "zh-CN" ? "app_name" : `app_name_${lang}`);

/**
 * The 桌面图标名称 as set ("" for a language not set) and the site title, in one read. Android won't
 * let anyone rename the icon, so the Owner or an admin sets short names in 设置 (Ke Li 2026-11-04).
 */
export async function appNames(env: Env): Promise<{ names: AppNames; title: string }> {
  const s = await getSettings(env.DB, ["site_title", ...SITE_LANGS.map(appNameKey)]);
  const names = Object.fromEntries(SITE_LANGS.map((l) => [l, s[appNameKey(l)] ?? ""])) as AppNames;
  return { names, title: titleFrom(s, env) };
}

export async function siteTheme(env: Env): Promise<ThemeId> {
  const s = await getSettings(env.DB, ["theme"]);
  return normalizeTheme(s.theme); // a pre-2026 palette name maps to its nearest new look
}

/** The test site (staging.…) shows a banner, is hidden from search engines and expects no real mail. */
export const isStaging = (env: Env) => env.ENVIRONMENT === "staging";
