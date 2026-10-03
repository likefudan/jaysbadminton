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
