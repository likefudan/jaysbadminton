/**
 * Appearance = a style (简约 or 极光) plus one of its four accents. The Owner picks the site default
 * in settings; each visitor can override it (and light/dark) on their own phone. The palettes
 * themselves live in styles.css, keyed by data-style / data-accent on <html>.
 */
export const STYLES = [
  {
    id: "minimal",
    name: "简约",
    accents: [
      { id: "coral", name: "珊瑚橙", swatch: ["#d38a6c", "#d38a6c"] },
      { id: "ocean", name: "海蓝", swatch: ["#6d8fb0", "#6d8fb0"] },
      { id: "forest", name: "森林绿", swatch: ["#6f9a7e", "#6f9a7e"] },
      { id: "grape", name: "葡萄紫", swatch: ["#9686b8", "#9686b8"] },
    ],
  },
  {
    id: "aurora",
    name: "极光",
    accents: [
      { id: "violet", name: "紫青", swatch: ["#9680d6", "#60acc4"] },
      { id: "sunset", name: "日落", swatch: ["#de9268", "#d27e9e"] },
      { id: "sea", name: "海洋", swatch: ["#6a8ecc", "#58a6a2"] },
      { id: "mint", name: "薄荷", swatch: ["#60aa8c", "#68b4c4"] },
    ],
  },
] as const;

type Style = (typeof STYLES)[number];
export type StyleId = Style["id"];
export type ThemeId = { [S in Style as S["id"]]: `${S["id"]}-${S["accents"][number]["id"]}` }[StyleId];

export interface Theme {
  id: ThemeId;
  style: StyleId;
  accent: string;
  name: string;
  swatch: readonly [string, string];
}

export const THEMES: Theme[] = STYLES.flatMap((s) =>
  s.accents.map((a) => ({
    id: `${s.id}-${a.id}` as ThemeId,
    style: s.id,
    accent: a.id,
    name: a.name,
    swatch: a.swatch,
  })),
);

export const DEFAULT_THEME: ThemeId = "minimal-coral";
export const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

/** The seven palettes before styles existed, mapped to the nearest new look (lagoon was the default). */
export const LEGACY_THEMES: Record<string, ThemeId> = {
  lagoon: "minimal-coral",
  ocean: "minimal-ocean",
  grape: "minimal-grape",
  sunset: "minimal-coral",
  sakura: "aurora-sunset",
  forest: "minimal-forest",
  graphite: "minimal-ocean",
};

/** Any stored value, old or new, to a valid theme. */
export function normalizeTheme(v: unknown): ThemeId {
  if (isTheme(v)) return v;
  if (typeof v === "string" && v in LEGACY_THEMES) return LEGACY_THEMES[v]!;
  return DEFAULT_THEME;
}

export const themeById = (id: ThemeId): Theme => THEMES.find((t) => t.id === id)!;

/**
 * Colours of the share images (活动分享 and 年度回顾), by accent. They follow the Owner's default
 * look, not a visitor's own, so every image from one group looks the same (Ke Li 2026-11-11).
 * `from`/`to` is the background, dark enough at the bottom for white words; `link` is the address
 * under the QR code; `ink` shades the QR code from its centre outward, all dark enough on white
 * for phone cameras.
 */
export interface ShareColours {
  from: string;
  to: string;
  link: string;
  ink: readonly [string, string, string];
}
export const SHARE_COLOURS: Record<string, ShareColours> = {
  coral: { from: "#e29a7b", to: "#b5634a", link: "#bf6f52", ink: ["#5a2214", "#7e3a24", "#9c4a2c"] },
  ocean: { from: "#8aa9c8", to: "#4a6a8a", link: "#4a6a8a", ink: ["#1d2f44", "#2c4560", "#3d5a7a"] },
  forest: { from: "#8db59a", to: "#4a725a", link: "#4a725a", ink: ["#1c3326", "#2a4a37", "#3a6249"] },
  grape: { from: "#ad9fcd", to: "#6f6196", link: "#6f6196", ink: ["#2c2245", "#40325f", "#56497e"] },
  violet: { from: "#9a84da", to: "#4f8fa6", link: "#64559e", ink: ["#2a2050", "#3d3270", "#3f6f80"] },
  sunset: { from: "#e39a6f", to: "#b85d82", link: "#a8613f", ink: ["#5a2214", "#7e3a3a", "#8c3f5f"] },
  sea: { from: "#6f93d0", to: "#3f8480", link: "#40639f", ink: ["#1a2a4a", "#284068", "#2a5f5c"] },
  mint: { from: "#66b092", to: "#4a8e9e", link: "#357558", ink: ["#173a2c", "#24543f", "#2d5e68"] },
};
export const shareColours = (id: ThemeId): ShareColours => SHARE_COLOURS[themeById(id).accent] ?? SHARE_COLOURS.coral!;
