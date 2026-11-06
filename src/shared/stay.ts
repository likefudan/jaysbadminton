/**
 * 在场时间 (Ke Li 2026-11-06): when signing up, a member may say when they arrive (到) and leave
 * (走), both optional, but 走 only together with 到. Times are Pacific HH:MM on a 15-minute grid
 * counted from the event's start, inside its start–end range. Events that run past midnight work
 * by counting minutes from the start. The fee split doesn't use them (Ke Li).
 */
import { isTime } from "./time";

export const STAY_STEP_MIN = 15;

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => {
  const d = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`;
};

/** Minutes the event lasts; an end at or before the start runs past midnight. */
export function eventLength(start: string, end: string): number {
  const d = (mins(end) - mins(start) + 1440) % 1440;
  return d === 0 ? 1440 : d;
}

/** Minutes from the event's start to `t` (same day, or past midnight). */
export const offsetOf = (start: string, t: string) => (mins(t) - mins(start) + 1440) % 1440;

/** The 到 choices: every 15 minutes from the start, up to the last step before the end. */
export function arriveChoices(start: string, end: string): string[] {
  const len = eventLength(start, end);
  const out: string[] = [];
  for (let m = 0; m < len; m += STAY_STEP_MIN) out.push(hhmm(mins(start) + m));
  return out;
}

/** The 走 choices once they arrive at `arrive`: every 15 minutes after it, up to the end. */
export function leaveChoices(start: string, end: string, arrive: string): string[] {
  const len = eventLength(start, end);
  const out: string[] = [];
  const a = offsetOf(start, arrive);
  if (a >= len) return out;
  for (let m = a + STAY_STEP_MIN; m < len; m += STAY_STEP_MIN) out.push(hhmm(mins(start) + m));
  // The end itself, also when it isn't on the 15-minute grid.
  out.push(hhmm(mins(start) + len));
  return out;
}

/**
 * The stay a sign-up sends, checked against the event: null/"" for not given. Throws a message
 * (Chinese, as the API's errors are) when it doesn't fit.
 */
export function checkStay(
  start: string,
  end: string,
  arrive: unknown,
  leave: unknown,
): { arrive: string | null; leave: string | null } | string {
  const a = arrive === null || arrive === undefined || arrive === "" ? null : arrive;
  const l = leave === null || leave === undefined || leave === "" ? null : leave;
  if (a === null) return l === null ? { arrive: null, leave: null } : "请先选到的时间";
  if (typeof a !== "string" || !arriveChoices(start, end).includes(a)) return "到的时间不在活动时间内";
  if (l === null) return { arrive: a, leave: null };
  if (typeof l !== "string" || !isTime(l) || !leaveChoices(start, end, a).includes(l))
    return "走的时间要在到的时间之后、活动结束之前";
  return { arrive: a, leave: l };
}

/**
 * 各时段人数: how many people are there in each 15-minute slot of the event. Someone with only
 * 到 counts until the end (Ke Li); people without 到 aren't counted. Stays outside the range
 * (the event's times were changed afterwards) are clipped to it.
 */
export function headcountSlots(
  start: string,
  end: string,
  stays: { arrive: string | null; leave: string | null }[],
): number[] {
  const len = eventLength(start, end);
  const n = Math.ceil(len / STAY_STEP_MIN);
  const slots = new Array<number>(n).fill(0);
  for (const s of stays) {
    if (!s.arrive || !isTime(s.arrive)) continue;
    const a = offsetOf(start, s.arrive);
    if (a >= len) continue;
    let l = s.leave && isTime(s.leave) ? offsetOf(start, s.leave) : len;
    if (l <= a || l > len) l = len;
    for (let i = 0; i < n; i++) {
      const t = i * STAY_STEP_MIN;
      if (t >= a && t < l) slots[i]!++;
    }
  }
  return slots;
}

/** The time `m` minutes after the start, for labels. */
export const timeAt = (start: string, m: number) => hhmm(mins(start) + m);
