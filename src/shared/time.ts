// All business times are Pacific. The Worker stores UTC ISO strings; these helpers convert both ways
// with Intl so daylight-saving changes are handled by the runtime's tz database.

export const TZ = "America/Los_Angeles";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

export interface PacificParts {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function toPacific(iso: string | Date): PacificParts {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: WEEKDAYS.indexOf(p.weekday!) };
}

/** Converts a Pacific wall-clock date + time to a UTC ISO string. */
export function pacificToUtc(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Pacific is UTC-7 or UTC-8; find the offset that maps back to the requested wall time.
  for (const offsetH of [7, 8]) {
    const guess = new Date(asUtc + offsetH * 3600_000);
    const back = toPacific(guess);
    if (back.date === date && back.time === time) return guess.toISOString();
  }
  // Wall time skipped by the spring-forward gap: use the instant one hour later.
  return new Date(asUtc + 7 * 3600_000).toISOString();
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** An event's date: "2026年10月6日 周二" (or "10月6日 周二" with withYear = false). */
export function formatDateZh(date: string, withYear = true): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${withYear ? `${y}年` : ""}${m}月${d}日 ${WEEKDAY_ZH[weekday]}`;
}

/** "10月5日 周一 20:00" for a UTC instant (deadlines, receipts), shown in Pacific time. */
export function formatInstantZh(iso: string): string {
  const p = toPacific(iso);
  return `${formatDateZh(p.date, false)} ${p.time}`;
}
