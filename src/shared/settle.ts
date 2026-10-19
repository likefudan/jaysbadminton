// Fee split from the requirements: courts are shared by everyone registered, shuttles by everyone
// who attended. Each total is split in whole cents so the shares add up to it exactly: everyone pays
// the same base amount and the leftover cents go one each to shares picked at random, but stably:
// the pick is a hash of the registration, so recomputing or showing a bill gives the same result. A
// member owes the sum of their own share and their friends' shares. Settlements saved before exact
// splitting (`roundUp`) keep rounding every share up, so their bills never change behind anyone's
// back. Shared by the Worker and the preview UI.

export interface SettleRow {
  /** The registration's id: decides, stably, which shares carry a leftover cent. */
  id: number;
  memberId: string;
  friendIndex: number;
  name: string;
  attended: boolean;
}

export interface SettleInput {
  courtTotalCents: number;
  shuttleCount: number;
  shuttlePriceCents: number;
  /** Legacy rule: every share rounded up to the cent, so the total can come out a few cents over. */
  roundUp?: boolean;
}

export interface Share {
  name: string;
  friendIndex: number;
  attended: boolean;
  courtCents: number;
  shuttleCents: number;
}

export interface MemberBill {
  memberId: string;
  totalCents: number;
  shares: Share[];
}

export interface Settlement {
  registered: number;
  attended: number;
  /** The base share; `courtExtraShares` of the shares pay one cent more. */
  courtShareCents: number;
  courtExtraShares: number;
  shuttleShareCents: number;
  shuttleExtraShares: number;
  bills: MemberBill[];
  totalCents: number;
}

/** Base share and how many shares pay one cent more, so `count` shares add up to `total`. */
function split(total: number, count: number, roundUp: boolean): [number, number] {
  if (count === 0) return [0, 0];
  if (roundUp) return [Math.ceil(total / count), 0];
  return [Math.floor(total / count), total % count];
}

/** FNV-1a: a cheap, stable hash, so the shares that carry a cent look random but never change. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The ids of the `extra` rows picked to pay one cent more (separate picks per fee, by `salt`). */
function picked(rows: SettleRow[], extra: number, salt: string): Set<number> {
  if (extra === 0) return new Set();
  const ranked = rows.map((r) => ({ id: r.id, h: hash(`${salt}:${r.id}`) }));
  ranked.sort((a, b) => a.h - b.h || a.id - b.id);
  return new Set(ranked.slice(0, extra).map((r) => r.id));
}

export function settle(rows: SettleRow[], input: SettleInput): Settlement {
  const roundUp = input.roundUp === true;
  const registered = rows.length;
  const attended = rows.filter((r) => r.attended).length;
  const [courtShareCents, courtExtraShares] = split(input.courtTotalCents, registered, roundUp);
  const [shuttleShareCents, shuttleExtraShares] = split(
    input.shuttleCount * input.shuttlePriceCents,
    attended,
    roundUp,
  );
  const courtExtra = picked(rows, courtExtraShares, "court");
  const shuttleExtra = picked(
    rows.filter((r) => r.attended),
    shuttleExtraShares,
    "shuttle",
  );
  const byMember = new Map<string, MemberBill>();
  for (const r of rows) {
    const share: Share = {
      name: r.name,
      friendIndex: r.friendIndex,
      attended: r.attended,
      courtCents: courtShareCents + (courtExtra.has(r.id) ? 1 : 0),
      shuttleCents: r.attended ? shuttleShareCents + (shuttleExtra.has(r.id) ? 1 : 0) : 0,
    };
    const bill = byMember.get(r.memberId) ?? { memberId: r.memberId, totalCents: 0, shares: [] };
    bill.shares.push(share);
    bill.totalCents += share.courtCents + share.shuttleCents;
    byMember.set(r.memberId, bill);
  }
  const bills = [...byMember.values()];
  for (const b of bills) b.shares.sort((x, y) => x.friendIndex - y.friendIndex);
  return {
    registered,
    attended,
    courtShareCents,
    courtExtraShares,
    shuttleShareCents,
    shuttleExtraShares,
    bills,
    totalCents: bills.reduce((s, b) => s + b.totalCents, 0),
  };
}

export const dollars = (cents: number) => (cents / 100).toFixed(2);

/** Parses "12.5", "$12.50" or "12" into cents; null if not a valid non-negative amount. */
export function parseDollars(raw: string | number): number | null {
  const s = String(raw).trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Venmo pay link with amount and note pre-filled (verified on a real phone before launch). */
export function venmoLink(username: string, cents: number, note: string): string {
  const user = username.replace(/^@/, "");
  const q = new URLSearchParams({ txn: "pay", recipients: user, amount: dollars(cents), note });
  return `https://venmo.com/?${q.toString()}`;
}
