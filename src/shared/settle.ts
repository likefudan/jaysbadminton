// Fee split from the requirements: courts are shared by everyone registered, shuttles by everyone
// who attended. Each person's share is rounded up to the cent separately, then a member owes the
// sum of their own share and their friends' shares. Shared by the Worker and the preview UI.

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
  courtShareCents: number;
  shuttleShareCents: number;
  bills: MemberBill[];
  totalCents: number;
}

const ceilDiv = (a: number, b: number) => (b === 0 ? 0 : Math.ceil(a / b));

export function settle(rows: SettleRow[], input: SettleInput): Settlement {
  const registered = rows.length;
  const attended = rows.filter((r) => r.attended).length;
  const courtShareCents = ceilDiv(input.courtTotalCents, registered);
  const shuttleShareCents = ceilDiv(input.shuttleCount * input.shuttlePriceCents, attended);
  const byMember = new Map<string, MemberBill>();
  for (const r of rows) {
    const share: Share = {
      name: r.name,
      friendIndex: r.friendIndex,
      attended: r.attended,
      courtCents: courtShareCents,
      shuttleCents: r.attended ? shuttleShareCents : 0,
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
    shuttleShareCents,
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
