/** Colour themes the Owner can pick in settings. The palettes themselves live in styles.css. */
export const THEMES = [
  { id: "lagoon", name: "湖水青", swatch: ["#3d7c76", "#4e7d8f"] },
  { id: "ocean", name: "海洋蓝", swatch: ["#4a6290", "#6a6491"] },
  { id: "grape", name: "葡萄紫", swatch: ["#77608c", "#956a80"] },
  { id: "sunset", name: "日落橙", swatch: ["#a8684f", "#a35e66"] },
  { id: "sakura", name: "樱花粉", swatch: ["#a4687f", "#8f6890"] },
  { id: "forest", name: "森林绿", swatch: ["#4d775a", "#6b7752"] },
  { id: "graphite", name: "石墨灰", swatch: ["#3e4550", "#5d6571"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "lagoon";
export const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
