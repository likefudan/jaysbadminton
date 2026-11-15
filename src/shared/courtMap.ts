import { QUEUE_COURT_MAX } from "./courtQueue";

/**
 * 球场图 (Ke Li 2026-11-15): the floor plan of a venue, so players see where our courts are. Every
 * venue is laid out differently, so nothing is drawn in code: the Owner, an admin or an organizer
 * photographs the venue's posted court map, the AI model reads it into this layout, they put it
 * right by hand and save it for that venue (its address, courtMapPlace). Events there then show it
 * from the 球场排队 card.
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

/** 以前的图 (Ke Li: 防止误操作): a venue's replaced or removed plans, 30 days, the newest 10. */
export const COURT_MAP_HISTORY_DAYS = 30;
export const COURT_MAP_HISTORY_MAX = 10;

/** One of 以前的图: the plan, who made it and when, and when it was replaced or removed. */
export interface CourtMapOld {
  id: number;
  layout: CourtMapLayout;
  savedBy: string;
  savedAt: string;
  replacedAt: string;
}

/** A posted plan has a few dozen courts and labels; this only stops a runaway answer. */
export const COURT_MAP_ITEMS_MAX = 200;
export const COURT_MAP_LABEL_MAX = 24;
/** A box thinner than this can't be seen or tapped, and would leave the editor no step to move by. */
const SIZE_MIN = 0.005;

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
 * Which venue a plan belongs to (Ke Li: 一个球馆只有一张图，要跟球馆地址对应): the venue's address,
 * letter case, spaces and punctuation aside. An event without an address goes by its venue name.
 */
export function courtMapPlace(venue: string, address: string): string {
  const flat = (v: string) =>
    v
      .toLowerCase()
      .replace(/[\s,.，。#]+/g, " ")
      .trim();
  const a = flat(address);
  return a ? `a:${a}` : `n:${flat(venue)}`;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

/** Values within `tol` of the one before them become one line, at their average. */
function lines(values: number[], tol: number): (v: number) => number {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1]! <= tol) g.push(v);
    else groups.push([v]);
  }
  const to = new Map<number, number>();
  for (const g of groups) {
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    for (const v of g) to.set(v, mean);
  }
  return (v) => to.get(v) ?? v;
}

/**
 * Courts are built in rows and columns (Ke Li: 不允许随意旋转或者不对齐): every court lying the same
 * way gets the same size, and courts nearly on one row or one column are put exactly on it. Boxes
 * have no angle at all, so nothing can be turned. Other boxes and labels are left where they are.
 */
export function alignLayout(layout: CourtMapLayout): CourtMapLayout {
  const courts = layout.items.filter((i) => i.kind === "court");
  if (courts.length === 0) return layout;
  // On the plan (not in fractions) a court is wider than tall, or the other way round.
  const wide = (i: CourtMapItem) => i.w * layout.aspect >= i.h;
  const size = new Map<boolean, { w: number; h: number }>();
  for (const flat of [true, false]) {
    const group = courts.filter((i) => wide(i) === flat);
    if (group.length) size.set(flat, { w: median(group.map((i) => i.w)), h: median(group.map((i) => i.h)) });
  }
  const cx = (i: CourtMapItem) => round(i.x + i.w / 2);
  const cy = (i: CourtMapItem) => round(i.y + i.h / 2);
  const col = lines(courts.map(cx), median(courts.map((i) => i.w)) * 0.25);
  const row = lines(courts.map(cy), median(courts.map((i) => i.h)) * 0.25);
  const clamp = (v: number, len: number) => round(Math.min(Math.max(0, v), 1 - len));
  return {
    aspect: layout.aspect,
    items: layout.items.map((i) => {
      if (i.kind !== "court") return i;
      const s = size.get(wide(i))!;
      return {
        ...i,
        w: round(s.w),
        h: round(s.h),
        x: clamp(col(cx(i)) - s.w / 2, s.w),
        y: clamp(row(cy(i)) - s.h / 2, s.h),
      };
    }),
  };
}

/** The lines other courts are on along one axis, and half the usual distance between them. */
function axis(layout: CourtMapLayout, index: number, at: (i: CourtMapItem) => number, own: number) {
  const marks = [...new Set(layout.items.filter((i, k) => k !== index && i.kind === "court").map(at))].sort(
    (a, b) => a - b,
  );
  const gaps = marks
    .slice(1)
    .map((m, k) => m - marks[k]!)
    .filter((g) => g > own * 0.5);
  return { marks, step: Math.max(SIZE_MIN, gaps.length ? median(gaps) : own) / 2 };
}

/** How far one press of an arrow moves a box: half a pitch each way. */
export function moveStep(layout: CourtMapLayout, index: number): { x: number; y: number } {
  const me = layout.items[index];
  if (!me) return { x: 0, y: 0 };
  return { x: axis(layout, index, (i) => i.x, me.w).step, y: axis(layout, index, (i) => i.y, me.h).step };
}

/**
 * Where a box being moved may rest: on a line other courts are on when it is close to one, else
 * half a pitch (the usual distance between lines) from the nearest line, as rows offset by half a
 * court are. With no other court to go by, steps of half its own size. So a court can't be left
 * slightly off its row or column.
 */
export function snapMove(layout: CourtMapLayout, index: number, x: number, y: number): { x: number; y: number } {
  const me = layout.items[index];
  if (!me) return { x, y };
  const snap = (v: number, own: number, at: (i: CourtMapItem) => number) => {
    const { marks, step } = axis(layout, index, at, own);
    const near = marks.reduce((best, m) => (Math.abs(m - v) < Math.abs(best - v) ? m : best), marks[0] ?? 0);
    const max = 1 - own;
    let out = near + Math.round((v - near) / step) * step;
    while (out < -1e-9) out += step;
    while (out > max + 1e-9) out -= step;
    return round(Math.min(Math.max(0, out), max));
  };
  return { x: snap(x, me.w, (i) => i.x), y: snap(y, me.h, (i) => i.y) };
}

/** A new court for ＋ 添加场地: the size of the others, in the first free spot along the bottom row. */
export function addCourt(layout: CourtMapLayout): CourtMapLayout {
  const courts = layout.items.filter((i) => i.kind === "court");
  const used = new Set(courts.map((i) => courtNumber(i.label)));
  let n = 1;
  while (used.has(n)) n++;
  const like = courts[courts.length - 1] ?? { w: 0.1, h: 0.06, x: 0, y: 0 };
  const item: CourtMapItem = { kind: "court", label: String(n), x: 0, y: 0, w: like.w, h: like.h };
  const withIt = { aspect: layout.aspect, items: [...layout.items, item] };
  const hit = (x: number, y: number) =>
    layout.items.some((i) => x < i.x + i.w && i.x < x + item.w && y < i.y + i.h && i.y < y + item.h);
  // Scan the plan from the bottom up for a free place on the courts' own lines.
  for (let y = 1 - item.h; y >= 0; y -= item.h / 2)
    for (let x = 0; x <= 1 - item.w; x += item.w / 2) {
      const at = snapMove(withIt, withIt.items.length - 1, x, y);
      if (!hit(at.x, at.y)) return { aspect: layout.aspect, items: [...layout.items, { ...item, ...at }] };
    }
  return withIt;
}

/**
 * A layout as it may be kept: from the model's answer or from the page. Boxes are kept inside the
 * plan, labels trimmed, a court whose label isn't a number becomes an area (it can't be on the
 * queue card), a number used twice keeps its first box, and the courts are put on their rows and
 * columns (alignLayout). Null when no court is left.
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
    if (cw < SIZE_MIN || ch < SIZE_MIN) continue;
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
  return alignLayout({ aspect: round(aspect), items });
}
