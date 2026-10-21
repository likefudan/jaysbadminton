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
  /** 拍照登记 is available (the site has a key for the model that reads the photo). */
  photo: boolean;
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

/** 拍照登记: the photo is shrunk on the phone to this many pixels on its long side (Ke Li). */
export const PHOTO_MAX_SIDE = 1600;

/** One of our accounts read off the screen; uncertain when the model wasn't sure of the name. */
export interface PhotoAccount {
  username: string;
  uncertain: boolean;
}

/** A court where the photo shows our accounts, in the shape of the 登记球场 form. */
export interface PhotoCourt {
  court: number;
  /** 0 = playing, 1..3 = that group in the court's queue. */
  position: number;
  /** The court's Minutes Left on the screen; null when it couldn't be read. */
  minutesLeft: number | null;
  accounts: PhotoAccount[];
}

export interface PhotoResult {
  courts: PhotoCourt[];
  /** Courts cut off or too blurry to read. */
  unreadable: number[];
}

/** One line of a pasted account list. */
export interface PastedAccount {
  username: string;
  password: string;
}

/**
 * 批量添加: reads a pasted list of numbered lines, "1. Cassie lion3", exactly as typed (no case
 * changes). Whatever comes before the first numbered line (a group note, a title) is skipped;
 * after it, a line that isn't "number. username password" is returned in `bad`. A username
 * repeated in the paste (any case) is kept once.
 */
export function parseAccountList(text: string): { accounts: PastedAccount[]; bad: string[] } {
  const accounts: PastedAccount[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  let started = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const numbered = /^\d+\s*[.、．)）]\s*(.*)$/.exec(line);
    if (!started && !numbered) continue;
    started = true;
    if (!line) continue;
    const parts = numbered?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    if (parts.length !== 2) {
      bad.push(line);
      continue;
    }
    const [username, password] = parts as [string, string];
    if (seen.has(username.toLowerCase())) continue;
    seen.add(username.toLowerCase());
    accounts.push({ username, password });
  }
  return { accounts, bad };
}
