import type { SpendEntry } from "./types";

/** 我的统计 time ranges, as the member picks them. */
export const RANGES = ["7D", "30D", "3M", "6M", "1Y", "YTD", "ALL"] as const;
export type RangeId = (typeof RANGES)[number];
export type BucketUnit = "day" | "week" | "month" | "year";

export interface Bucket {
  /** First and last day this column covers, clipped to the range. */
  start: string;
  end: string;
  /** Short axis label: "10/2", "9月", "2027". */
  label: string;
  cents: number;
  /** Times they came (not counting events they were billed for but missed). */
  count: number;
}

export interface RangeSummary {
  start: string;
  end: string;
  unit: BucketUnit;
  buckets: Bucket[];
  entries: SpendEntry[];
  count: number;
  cents: number;
  /** null when they didn't come at all in the range. */
  avgCents: number | null;
}

// Dates are Pacific calendar days "YYYY-MM-DD"; the arithmetic runs on UTC noon so it never slips a day.
const toTime = (d: string) => Date.parse(`${d}T12:00:00Z`);
const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toDate(toTime(d) + n * 86400_000);

/** The same day n months earlier or later, clamped to the month's end (3/31 − 1 month = 2/28). */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return toDate(first.getTime());
}

const mondayOf = (d: string) => addDays(d, -((new Date(toTime(d)).getUTCDay() + 6) % 7));
const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / 86400_000);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function rangeStart(range: RangeId, today: string, history: SpendEntry[]): string {
  switch (range) {
    case "7D":
      return addDays(today, -6);
    case "30D":
      return addDays(today, -29);
    case "3M":
      return addDays(addMonths(today, -3), 1);
    case "6M":
      return addDays(addMonths(today, -6), 1);
    case "1Y":
      return addDays(addMonths(today, -12), 1);
    case "YTD":
      return `${today.slice(0, 4)}-01-01`;
    case "ALL": {
      const first = history[0]?.date;
      return first && first < today ? first : today;
    }
  }
}

/** Column width: about 5–26 columns whatever the range. */
export function bucketUnit(range: RangeId, start: string, today: string): BucketUnit {
  if (range === "7D") return "day";
  if (range === "30D" || range === "3M") return "week";
  if (range === "6M" || range === "1Y") return "month";
  const span = daysBetween(start, today);
  if (span <= 62) return span <= 7 ? "day" : "week";
  return range === "ALL" && span > 3 * 366 ? "year" : "month";
}

function nextStart(d: string, unit: BucketUnit): string {
  if (unit === "day") return addDays(d, 1);
  if (unit === "week") return addDays(d, 7);
  if (unit === "month") return addMonths(`${d.slice(0, 7)}-01`, 1);
  return `${Number(d.slice(0, 4)) + 1}-01-01`;
}

function firstStart(d: string, unit: BucketUnit): string {
  if (unit === "day") return d;
  if (unit === "week") return mondayOf(d);
  if (unit === "month") return `${d.slice(0, 7)}-01`;
  return `${d.slice(0, 4)}-01-01`;
}

function label(d: string, unit: BucketUnit, startYear: string, endYear: string): string {
  if (unit === "day" || unit === "week") return md(d);
  if (unit === "year") return d.slice(0, 4);
  const m = Number(d.slice(5, 7));
  // Across years, January shows the year so the axis says where it turns over.
  return m === 1 && startYear !== endYear ? d.slice(0, 4) : `${m}月`;
}

/** Everything 我的统计 shows for one range: the columns, the totals and the events behind them. */
export function summarize(history: SpendEntry[], range: RangeId, today: string): RangeSummary {
  const start = rangeStart(range, today, history);
  const unit = bucketUnit(range, start, today);
  const entries = history.filter((e) => e.date >= start && e.date <= today);
  const buckets: Bucket[] = [];
  for (let b = firstStart(start, unit); b <= today; b = nextStart(b, unit)) {
    const from = b < start ? start : b;
    const lastDay = addDays(nextStart(b, unit), -1);
    const to = lastDay > today ? today : lastDay;
    const inside = entries.filter((e) => e.date >= from && e.date <= to);
    buckets.push({
      start: from,
      end: to,
      label: label(b, unit, start.slice(0, 4), today.slice(0, 4)),
      cents: inside.reduce((t, e) => t + e.cents, 0),
      count: inside.filter((e) => e.attended).length,
    });
  }
  const count = entries.filter((e) => e.attended).length;
  const cents = entries.reduce((t, e) => t + e.cents, 0);
  return {
    start,
    end: today,
    unit,
    buckets,
    entries,
    count,
    cents,
    avgCents: count ? Math.round(cents / count) : null,
  };
}

/** A clean top for the y-axis and its step (in cents): 1, 2 or 5 × 10ⁿ whole dollars, 2–4 gridlines. */
export function niceScale(maxCents: number): { top: number; step: number } {
  if (maxCents <= 0) return { top: 1000, step: 500 };
  const raw = maxCents / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw)!;
  const rounded = Math.max(100, Math.round(step / 100) * 100); // whole dollars
  return { top: Math.ceil(maxCents / rounded) * rounded, step: rounded };
}

/** "9/29–10/5", "10/2", "2026年9月" for a column's readout. */
export function bucketTitle(b: Bucket, unit: BucketUnit): string {
  if (unit === "day" || b.start === b.end) return md(b.start);
  if (unit === "month") return `${b.start.slice(0, 4)}年${Number(b.start.slice(5, 7))}月`;
  if (unit === "year") return `${b.start.slice(0, 4)}年`;
  return `${md(b.start)}–${md(b.end)}`;
}
