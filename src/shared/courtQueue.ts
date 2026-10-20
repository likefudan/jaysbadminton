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
/** Minutes left or minutes to wait: three full rounds at most; this only stops typos. */
export const QUEUE_MINUTES_MAX = 400;
/** Some halls have more than fifty courts (Ke Li). */
export const QUEUE_COURT_MAX = 99;
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
  /** 0 = entered as playing, 1..3 = that group in the court's queue, as entered. */
  position: number;
  /** When a queued group is expected on court; null when entered as playing. UTC ISO. */
  startsAt: string | null;
  /** When the group's round ends. UTC ISO. */
  endsAt: string;
  /** The hall usernames in our group. */
  accounts: string[];
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

/** The 球场排队 part of an event card; only for players on the event, while it is on. */
export interface QueueInfo {
  roundMin: number;
  accounts: QueueAccount[];
  courts: QueueCourt[];
}

export type CourtPhase =
  | { phase: "playing"; minutes: number }
  | { phase: "queued"; minutes: number }
  | { phase: "done" };

/**
 * Where a court entry stands at `now` (ms): queued until it is expected on court, then playing
 * until its round ends, then done. Minutes are rounded up, so "1 分钟" shows until the very end.
 */
export function courtPhase(c: Pick<QueueCourt, "startsAt" | "endsAt">, now: number): CourtPhase {
  const up = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
  const starts = c.startsAt ? Date.parse(c.startsAt) : null;
  const ends = Date.parse(c.endsAt);
  if (starts !== null && now < starts) return { phase: "queued", minutes: up(starts - now) };
  if (now < ends) return { phase: "playing", minutes: up(ends - now) };
  return { phase: "done" };
}

/**
 * The wait for the k-th group in a court's queue, from the screen: the group on court finishes
 * its Minutes Left, then each of the k-1 groups ahead plays a full round.
 */
export const queueWait = (minutesLeft: number, position: number, roundMin: number): number =>
  minutesLeft + Math.max(0, position - 1) * roundMin;
