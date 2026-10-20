/**
 * 球场排队: events at halls where courts are taken by queuing on the hall's own computer. Players
 * share hall accounts on the event and enter, by hand, the courts we hold or queue for; the pages
 * count down from what was entered and estimate when each queued group gets on.
 */

export const QUEUE_DEFAULT_ROUND_MIN = 45;
export const QUEUE_ROUND_MIN = 10;
export const QUEUE_ROUND_MAX = 120;
/** The hall's screen shows three groups waiting per court. */
export const QUEUE_MAX_POSITION = 3;
/** A group on the hall's form is one to four players. */
export const QUEUE_GROUP_MAX = 4;
/** Minutes Left on the screen never runs past a round; this only stops typos. */
export const QUEUE_MINUTES_MAX = 180;
export const QUEUE_COURT_MAX = 50;
/** At or under this, a court on the screen turns yellow (time almost up). */
export const QUEUE_SOON_MIN = 5;

export interface QueueAccount {
  id: number;
  username: string;
  password: string;
  /** Who added it, by name. */
  addedBy: string;
  /** Added by the viewer: they may take it off again. */
  mine: boolean;
}

export interface QueueCourt {
  id: number;
  court: number;
  /** 0 = playing now, 1..3 = that group in the court's queue, as entered. */
  position: number;
  /** Minutes Left for the group on the court, as on the screen when it was entered. */
  minutesLeft: number;
  /** The hall usernames in our group. */
  accounts: string[];
  enteredAt: string; // UTC ISO
  enteredBy: string;
}

/** The 球场排队 part of an event card; only for players on the event, while it is on. */
export interface QueueInfo {
  roundMin: number;
  accounts: QueueAccount[];
  courts: QueueCourt[];
}

export type CourtPhase =
  | { phase: "playing"; endsAt: number; minutes: number }
  | { phase: "queued"; startsAt: number; minutes: number }
  | { phase: "done" };

/**
 * Where a court entry stands at `now` (ms). Playing: the group ends minutesLeft after it was
 * entered. Queued k-th: it gets on when the group on the court finishes and the k-1 groups ahead
 * each play a full round, then plays a round itself; past that it is done. Minutes are rounded up,
 * so "1 minute" shows until the very end.
 */
export function courtPhase(c: QueueCourt, roundMin: number, now: number): CourtPhase {
  const entered = Date.parse(c.enteredAt);
  const min = 60_000;
  const up = (ms: number) => Math.max(0, Math.ceil(ms / min));
  if (c.position === 0) {
    const endsAt = entered + c.minutesLeft * min;
    return now < endsAt ? { phase: "playing", endsAt, minutes: up(endsAt - now) } : { phase: "done" };
  }
  const startsAt = entered + (c.minutesLeft + (c.position - 1) * roundMin) * min;
  if (now < startsAt) return { phase: "queued", startsAt, minutes: up(startsAt - now) };
  const endsAt = startsAt + roundMin * min;
  return now < endsAt ? { phase: "playing", endsAt, minutes: up(endsAt - now) } : { phase: "done" };
}
