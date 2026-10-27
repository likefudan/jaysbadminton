import { getSettings } from "./db";
import type { Env } from "./env";
import { normalizeTheme, type ThemeId } from "../shared/themes";

export const DEFAULT_SITE_TITLE = "Jay's 羽毛球";
export const SITE_TITLE_MAX = 30;

export async function siteTitle(env: Env): Promise<string> {
  const s = await getSettings(env.DB, ["site_title"]);
  return s.site_title || env.SITE_NAME || DEFAULT_SITE_TITLE;
}

export async function siteTheme(env: Env): Promise<ThemeId> {
  const s = await getSettings(env.DB, ["theme"]);
  return normalizeTheme(s.theme); // a pre-2026 palette name maps to its nearest new look
}

/** The test site (staging.…) shows a banner, is hidden from search engines and expects no real mail. */
export const isStaging = (env: Env) => env.ENVIRONMENT === "staging";
