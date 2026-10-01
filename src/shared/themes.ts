/** Colour themes the Owner can pick in settings. The palettes themselves live in styles.css. */
export const THEMES = [
  { id: "lagoon", name: "湖水青", swatch: ["#0d9488", "#06b6d4"] },
  { id: "ocean", name: "海洋蓝", swatch: ["#2563eb", "#7c3aed"] },
  { id: "grape", name: "葡萄紫", swatch: ["#9333ea", "#ec4899"] },
  { id: "sunset", name: "日落橙", swatch: ["#ea580c", "#e11d48"] },
  { id: "sakura", name: "樱花粉", swatch: ["#db2777", "#f472b6"] },
  { id: "forest", name: "森林绿", swatch: ["#15803d", "#65a30d"] },
  { id: "graphite", name: "石墨灰", swatch: ["#334155", "#64748b"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: ThemeId = "lagoon";
export const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
