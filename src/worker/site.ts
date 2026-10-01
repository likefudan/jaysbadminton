import { getSettings } from "./db";
import type { Env } from "./env";

export const DEFAULT_SITE_TITLE = "Jay's 羽毛球";
export const SITE_TITLE_MAX = 30;

export async function siteTitle(env: Env): Promise<string> {
  const s = await getSettings(env.DB, ["site_title"]);
  return s.site_title || DEFAULT_SITE_TITLE;
}
