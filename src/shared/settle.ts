// Fee split from the requirements: courts are shared by everyone registered, shuttles by everyone
// who attended. Each total is split in whole cents so the shares add up to it exactly: everyone pays
// the same base amount and the leftover cents go one each to the first shares in sign-up order. A
// member owes the sum of their own share and their friends' shares. Settlements saved before exact
// splitting (`roundUp`) keep rounding every share up, so their bills never change behind anyone's
// back. Shared by the Worker and the preview UI.

export interface SettleRow {
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
  /** The base share; the first `courtExtraShares` shares pay one cent more. */
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
  const byMember = new Map<string, MemberBill>();
  let courtSeen = 0;
  let shuttleSeen = 0;
  for (const r of rows) {
    const share: Share = {
      name: r.name,
      friendIndex: r.friendIndex,
      attended: r.attended,
      courtCents: courtShareCents + (courtSeen++ < courtExtraShares ? 1 : 0),
      shuttleCents: r.attended ? shuttleShareCents + (shuttleSeen++ < shuttleExtraShares ? 1 : 0) : 0,
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
