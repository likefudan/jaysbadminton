export type MemberStatus = "pending" | "active" | "inactive";

export interface MemberSummary {
  id: string;
  username: string;
  wechatNickname: string;
  status: MemberStatus;
  isOwner: boolean;
  requestedAt: string;
  approvedAt: string | null;
}

export interface MembersResponse {
  pending: MemberSummary[];
  active: MemberSummary[];
  inactive: MemberSummary[];
}

export interface LinkResponse {
  link: string;
}

export interface MeResponse {
  id: string;
  username: string;
  wechatNickname: string;
  isOwner: boolean;
}

export type EventStatus = "open" | "closed" | "finalized" | "settled" | "cancelled";

export interface EventSummary {
  id: number;
  code: string;
  date: string; // Pacific YYYY-MM-DD
  startTime: string; // Pacific HH:MM
  endTime: string;
  location: string;
  deadlineAt: string; // UTC ISO
  status: EventStatus;
  headcount: number; // members + friends
}

export interface RosterEntry {
  id: number;
  memberId: string;
  memberName: string;
  friendIndex: number; // 0 = the member
  name: string; // display name; friends without a name show as "<member>的朋友<n>"
  attended: boolean;
  addedByOwner: boolean;
}

export interface EventDetail extends EventSummary {
  roster: RosterEntry[];
}

export interface MyEvent extends EventSummary {
  /** null when not signed up; otherwise the names entered for each friend ("" = unnamed). */
  myFriends: string[] | null;
  canEdit: boolean;
  /** Present once the event is finalized and the member owes something. */
  payment: MyPayment | null;
}

export interface EventDefaults {
  startTime: string;
  endTime: string;
  location: string;
  deadlineDays: number;
  deadlineHours: number;
  locations: string[];
  friendCap: number;
}

export interface HomeResponse {
  currentEvents: EventSummary[];
  pastEvents: EventSummary[];
  leaderboard: unknown[];
}

export interface PublicEvent extends EventSummary {
  roster: { name: string; isFriend: boolean; attended: boolean }[];
  showAttendance: boolean;
}

export const STATUS_ZH: Record<EventStatus, string> = {
  open: "报名中",
  closed: "已截止",
  finalized: "待收款",
  settled: "已收齐",
  cancelled: "已取消",
};

export type PaymentStatus = "unpaid" | "partial" | "paid";

/** One payment toward a bill; a bill can be paid in several pieces. */
export interface Receipt {
  id: number;
  amountCents: number;
  method: "venmo" | "manual";
  payerName: string | null;
  receivedAt: string;
}

export interface PaymentRow {
  id: number;
  memberId: string;
  memberName: string;
  isOwner: boolean;
  amountDueCents: number;
  paymentCode: string;
  status: PaymentStatus;
  amountPaidCents: number; // sum of receipts
  /** Over-payment still to send back (paid − due − already refunded), 0 when none. */
  refundCents: number;
  receipts: Receipt[];
}

export interface SettlementInputs {
  courtTotal: string; // dollars as typed
  shuttleCount: number;
  shuttlePrice: string;
}

export interface SettlementView {
  inputs: SettlementInputs | null; // saved inputs once finalized
  defaultShuttlePrice: string;
  payments: PaymentRow[];
  totals: { dueCents: number; paidCents: number; unpaidCount: number };
}

export interface MyPayment {
  amountCents: number; // due
  paidCents: number;
  refundCents: number;
  status: PaymentStatus;
  code: string;
  shares: import("./settle").Share[];
  venmoUsername: string;
  zelleAccount: string;
}

export type InboundKind = "unmatched"; // older rows may hold "anomaly" / "other" / "parse_failed"

/** A forwarded Venmo payment the Owner reviews (待确认), or one already handled. */
export interface InboundRow {
  id: number;
  kind: InboundKind;
  state: "open" | "linked" | "ignored";
  payerName: string | null;
  amountCents: number | null;
  note: string | null;
  receivedAt: string;
  txnId: string | null;
  /** Why it needs review, or what was done with it. */
  reason: string | null;
  linked: { paymentId: number; memberName: string; eventLabel: string } | null;
}

/** A payment still waiting for money, offered as a link target for an inbound row. */
export interface OpenPayment {
  id: number;
  eventLabel: string; // "10月6日 周二"
  memberName: string;
  amountDueCents: number;
  amountPaidCents: number;
  status: PaymentStatus;
  paymentCode: string;
}

/** A bill that received more than it was due and still has money to send back. */
export interface RefundRow {
  paymentId: number;
  eventLabel: string;
  memberName: string;
  amountDueCents: number;
  amountPaidCents: number;
  refundCents: number;
  receipts: Receipt[];
}

export interface InboundResponse {
  open: InboundRow[];
  done: InboundRow[];
  payments: OpenPayment[];
  refunds: RefundRow[];
}
