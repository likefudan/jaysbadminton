/**
 * 抽奖 (Ke Li 2026-11-16, 百人庆祝抽奖, option C 百人头像墙). Shared by the Worker, which draws, and
 * the page, which plays the draw and lets anyone check it.
 *
 * Fair and checkable: when the 抽奖 is published, the list is locked and a random seed is made; only
 * its fingerprint (SHA-256) is shown. 开奖 reveals the seed, and the winners follow from the seed and
 * the list alone, so anyone can work them out again and see that nobody chose them.
 */

export interface LotteryPrize {
  name: string;
  count: number;
}

/** Limits for 设置 → 抽奖. */
export const LOTTERY_POOL_MAX = 1000;
export const LOTTERY_PRIZE_ROWS = 10;
export const LOTTERY_PRIZE_NAME_MAX = 30;
export const LOTTERY_TITLE_MAX = 30;
/** 打气: taps one member can add (the button is for fun, not a contest). */
export const LOTTERY_CHEERS_MAX = 99;
/** 热度: the levels the group's 打气 total climbs through. */
export const LOTTERY_HEAT = [20, 50, 100, 200, 400, 800, 1500, 3000, 6000, 10000];
/** The level reached (from 0) and how far along the way to the next (0–1). */
export function heatOf(cheers: number): { level: number; part: number; next: number | null } {
  const level = LOTTERY_HEAT.filter((n) => cheers >= n).length;
  const from = level === 0 ? 0 : LOTTERY_HEAT[level - 1]!;
  const next = LOTTERY_HEAT[level] ?? null;
  return { level, part: next === null ? 1 : (cheers - from) / (next - from), next };
}

/**
 * The live draw's clock, the same on every phone: draw k (from 1) starts its shuttle at
 * drawnAt + INTRO + (k - 1) × GAP and lands ANIM later, then the winner stays up until the next.
 */
export const LOTTERY_INTRO_MS = 5_000;
export const LOTTERY_ANIM_MS = 9_000;
export const LOTTERY_GAP_MS = 15_000;
/** While waiting for the draw, the faces on the wall change places this often. */
export const LOTTERY_SHUFFLE_MS = 12_000;
/** Who has the page open: seen this recently. The page checks in more often than this. */
export const LOTTERY_ONLINE_MS = 30_000;

export const drawStart = (drawnAt: number, k: number) => drawnAt + LOTTERY_INTRO_MS + (k - 1) * LOTTERY_GAP_MS;
export const drawLand = (drawnAt: number, k: number) => drawStart(drawnAt, k) + LOTTERY_ANIM_MS;
/** When the last of `n` draws has landed. */
export const drawEnd = (drawnAt: number, n: number) => (n > 0 ? drawLand(drawnAt, n) : drawnAt);

/** Each prize once per tube, in draw order: [亚3, 亚3, 亚3, 黑航空, 黑航空]. */
export const prizeSlots = (prizes: LotteryPrize[]) => prizes.flatMap((p) => Array<string>(p.count).fill(p.name));

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** A new seed: 32 random bytes, in hex. */
export function newSeed(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer);
}

/**
 * The winners' numbers, one per draw. Draw k takes SHA-256 of "seed:k", reads its first 6 bytes as a
 * number and counts that far (modulo how many are left) along the numbers not drawn yet, smallest first.
 */
export async function drawWinners(seed: string, ranks: number[], draws: number): Promise<number[]> {
  const left = [...ranks].sort((a, b) => a - b);
  const out: number[] = [];
  for (let k = 1; k <= draws && left.length > 0; k++) {
    const h = await sha256Hex(`${seed}:${k}`);
    const n = Number.parseInt(h.slice(0, 12), 16);
    out.push(left.splice(n % left.length, 1)[0]!);
  }
  return out;
}

/** Problems with what 设置 → 抽奖 was given, or null. */
export function checkLottery(input: { title: string; poolSize: number; prizes: LotteryPrize[] }): string | null {
  if (!input.title.trim()) return "请填写抽奖的名字";
  if (input.title.trim().length > LOTTERY_TITLE_MAX) return `名字最多 ${LOTTERY_TITLE_MAX} 个字`;
  if (!Number.isInteger(input.poolSize) || input.poolSize < 1 || input.poolSize > LOTTERY_POOL_MAX)
    return `参加人数请填 1 到 ${LOTTERY_POOL_MAX}`;
  if (input.prizes.length === 0) return "请至少填一个奖品";
  if (input.prizes.length > LOTTERY_PRIZE_ROWS) return `最多 ${LOTTERY_PRIZE_ROWS} 种奖品`;
  for (const p of input.prizes) {
    if (!p.name.trim()) return "请填写奖品名称";
    if (p.name.trim().length > LOTTERY_PRIZE_NAME_MAX) return `奖品名称最多 ${LOTTERY_PRIZE_NAME_MAX} 个字`;
    if (!Number.isInteger(p.count) || p.count < 1 || p.count > 100) return "每种奖品的数量请填 1 到 100";
  }
  if (prizeSlots(input.prizes).length > input.poolSize) return "奖品比参加的人还多";
  return null;
}

export interface LotteryEntry {
  /** Their place in the order members were let in, from 1: the number on their face. */
  rank: number;
  id: string;
  name: string;
  avatar: string | null;
  /** Has the page open now (or did within LOTTERY_ONLINE_MS). Only for the look of the wall. */
  online: boolean;
  /** 打气: how many times they have tapped, so the wall can show who is cheering. */
  cheers: number;
}

export interface LotteryWinner {
  drawNo: number;
  rank: number;
  prize: string;
}

/** The 抽奖 page. */
export interface LotteryView {
  /** 0 for a 预演. */
  id: number;
  title: string;
  poolSize: number;
  prizes: LotteryPrize[];
  /** The time announced. */
  drawAt: string;
  status: "open" | "drawn";
  seedHash: string;
  /** Shown once every draw has landed. */
  seed: string | null;
  /** When 开奖 was pressed: the draws' clock (drawStart). */
  drawnAt: string | null;
  /** Who pressed 开奖 (whom the winners contact). */
  host: string | null;
  /** The server's clock, so every phone plays the draw at the same moment. */
  now: string;
  entries: LotteryEntry[];
  /** The draws whose shuttle has set off. */
  winners: LotteryWinner[];
  /** How many draws there are. */
  draws: number;
  /** The member looking; null on the 管理页. rank: their place among all members let in. */
  me: {
    id: string;
    rank: number | null;
    inPool: boolean;
    cheers: number;
    /** They took themselves off the list (the 抽奖 card). */
    optedOut: boolean;
    /** They can still leave or come back: not locked, not drawn. */
    canOpt: boolean;
  } | null;
  watching: number;
  cheers: number;
  /** The Owner locked it: nobody can change or cancel it until they unlock it. */
  locked: boolean;
  rehearsal: boolean;
}

export interface LotteryAdmin {
  /** The 抽奖 published or drawn (not yet taken off), as members see it. */
  current: LotteryView | null;
  /** Without one: the list publishing would lock now (the first N, before any are taken off). */
  preview: LotteryEntry[];
  /** With one: those among the first N taken off by hand, who don't take part. */
  excluded: LotteryEntry[];
  /** Those of `excluded` who left by themselves: only they can come back. */
  selfOut: string[];
  members: number;
  /** Members with push on, who get the notices. */
  pushMembers: number;
  /** The Owner: may lock and unlock. */
  canLock: boolean;
}

export interface LotteryRehearsal {
  view: LotteryView;
  checks: {
    /** Taking part. */
    entries: number;
    /** Among the first poolSize, taken off by hand. */
    excluded: number;
    poolSize: number;
    noAvatar: number;
    pushMembers: number;
    /** The presser's own devices with push on: where the 预演 push goes once the draw has played. */
    myDevices: number;
  };
}

/** One past 抽奖, kept for the Owner and admins (Ke Li 2026-11-16: 保留历次抽奖的记录). */
export interface LotteryRecord {
  id: number;
  title: string;
  status: "drawn" | "cancelled";
  poolSize: number;
  prizes: LotteryPrize[];
  drawAt: string;
  createdAt: string;
  /** Who set it up. */
  host: string | null;
  seed: string;
  seedHash: string;
  /** Who took part, by number. */
  entries: { rank: number; name: string }[];
  /** Among the first poolSize, taken off by hand. */
  excluded: { rank: number; name: string }[];
  winners: (LotteryWinner & { name: string })[];
}
