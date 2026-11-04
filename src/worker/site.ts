import { APP_NAME_LANGS, type AppNameLang, type AppNames } from "../shared/rules";
import { getSettings } from "./db";
import type { Env } from "./env";
import { normalizeTheme, type ThemeId } from "../shared/themes";

export const DEFAULT_SITE_TITLE = "Jay's 羽毛球";
export const SITE_TITLE_MAX = 30;

export async function siteTitle(env: Env): Promise<string> {
  const s = await getSettings(env.DB, ["site_title"]);
  return s.site_title || env.SITE_NAME || DEFAULT_SITE_TITLE;
}

/** Where each language's 桌面图标名称 is kept: Simplified under the plain key. */
export const appNameKey = (lang: AppNameLang) => (lang === "zh-CN" ? "app_name" : `app_name_${lang}`);

/** The 桌面图标名称 as set, "" for a language not set. */
export async function appNamesSet(env: Env): Promise<AppNames> {
  const s = await getSettings(env.DB, APP_NAME_LANGS.map(appNameKey));
  return Object.fromEntries(APP_NAME_LANGS.map((l) => [l, s[appNameKey(l)] ?? ""])) as AppNames;
}

/**
 * The name under the home-screen icon in each language (Ke Li 2026-11-04). Android won't let anyone
 * rename it, so the Owner or an admin sets short ones in 设置. A language not set uses Simplified's,
 * and with none set it is the site title.
 */
export async function appNames(env: Env): Promise<AppNames> {
  const set = await appNamesSet(env);
  const fallback = set["zh-CN"] || (await siteTitle(env));
  return Object.fromEntries(APP_NAME_LANGS.map((l) => [l, set[l] || fallback])) as AppNames;
}

export const isAppNameLang = (s: string | undefined): s is AppNameLang =>
  (APP_NAME_LANGS as readonly string[]).includes(s ?? "");

export async function siteTheme(env: Env): Promise<ThemeId> {
  const s = await getSettings(env.DB, ["theme"]);
  return normalizeTheme(s.theme); // a pre-2026 palette name maps to its nearest new look
}

/** The test site (staging.…) shows a banner, is hidden from search engines and expects no real mail. */
export const isStaging = (env: Env) => env.ENVIRONMENT === "staging";
