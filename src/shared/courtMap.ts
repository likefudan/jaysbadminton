import { QUEUE_COURT_MAX } from "./courtQueue";

/**
 * 球场图 (Ke Li 2026-11-15): the floor plan of a venue, so players see where our courts are. Every
 * venue is laid out differently, so nothing is drawn in code: the Owner or an admin photographs the
 * venue's posted court map once, the AI model reads it into this layout, they check it and save it
 * for that venue. Events at the venue (same name) then show it from the 球场排队 card.
 *
 * Positions are fractions of the plan's outer border (0..1), so the drawing scales to any screen.
 */
export interface CourtMapItem {
  /**
   * court: a numbered badminton court, coloured by our queue state. area: anything else drawn as a
   * box (other sports' courts, the front desk, a sign-up station). text: a label on the plan.
   */
  kind: "court" | "area" | "text";
  /** The court's number, or the box's or label's text. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CourtMapLayout {
  /** Width / height of the plan. */
  aspect: number;
  items: CourtMapItem[];
}

/** A posted plan has a few dozen courts and labels; this only stops a runaway answer. */
export const COURT_MAP_ITEMS_MAX = 200;
export const COURT_MAP_LABEL_MAX = 24;

const KINDS = ["court", "area", "text"] as const;
const frac = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
const round = (v: number) => Math.round(v * 10_000) / 10_000;

/** A court's number when its label is one (1–99), else null. */
export function courtNumber(label: string): number | null {
  if (!/^\d{1,2}$/.test(label)) return null;
  const n = Number(label);
  return n >= 1 && n <= QUEUE_COURT_MAX ? n : null;
}

/**
 * A layout as it may be kept: from the model's answer or from the page. Boxes are kept inside the
 * plan, labels trimmed, a court whose label isn't a number becomes an area (it can't be on the
 * queue card), and a number used twice keeps its first box. Null when no court is left.
 */
export function cleanLayout(raw: unknown): CourtMapLayout | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as { aspect?: unknown; items?: unknown };
  const aspect = typeof r.aspect === "number" && Number.isFinite(r.aspect) ? r.aspect : 0;
  if (aspect < 0.2 || aspect > 5) return null;
  const seen = new Set<number>();
  const items: CourtMapItem[] = [];
  for (const it of Array.isArray(r.items) ? r.items : []) {
    if (items.length >= COURT_MAP_ITEMS_MAX) break;
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    let kind = KINDS.find((k) => k === o.kind);
    const label = typeof o.label === "string" ? [...o.label.trim()].slice(0, COURT_MAP_LABEL_MAX).join("") : "";
    const x = frac(o.x);
    const y = frac(o.y);
    const w = frac(o.w);
    const h = frac(o.h);
    if (!kind || x === null || y === null || w === null || h === null) continue;
    const cw = Math.min(w, 1 - x);
    const ch = Math.min(h, 1 - y);
    if (cw <= 0 || ch <= 0) continue;
    if (kind === "court") {
      const n = courtNumber(label);
      if (n === null) kind = "area";
      else if (seen.has(n)) continue;
      else seen.add(n);
    }
    if (kind === "text" && !label) continue;
    items.push({ kind, label, x: round(x), y: round(y), w: round(cw), h: round(ch) });
  }
  if (seen.size === 0) return null;
  return { aspect: round(aspect), items };
}
