export type MemberStatus = "pending" | "active" | "inactive";

export interface MemberSummary {
  id: string;
  username: string;
  wechatNickname: string;
  status: MemberStatus;
  isOwner: boolean;
  requestedAt: string;
  approvedAt: string | null;
  deletedAt: string | null;
  /** False for members disabled before links were kept; the admin can generate a new one. */
  hasLink: boolean;
  /** The Google account a member signs in with, if any (shown so the admin knows who applied). */
  googleEmail: string | null;
  applicantName?: string;
  wechatAccount?: string;
  approvalEmailStatus?: string | null;
  /** The admin's own name for this person, to tell people apart (never shown to members). */
  adminNote: string;
  /** Still owed across all bills (only filled in for the admin's member list). */
  owingCents: number;
}

export interface MembersResponse {
  pending: MemberSummary[];
  active: MemberSummary[];
  inactive: MemberSummary[]; // 已停用: can pay, cannot sign up
  deleted: MemberSummary[]; // 已删除: link gone, history kept
}

export interface LinkResponse {
  link: string;
}

/** Approving a request: a link to send, or none when they applied with Google and just sign in. */
export type ApprovalEmailStatus = "sent" | "failed" | "not_configured" | "not_needed";

export interface ApproveResponse {
  emailStatus?: ApprovalEmailStatus;
  link: string | null;
  googleEmail: string | null;
}

/** One event on the 个人信息 activity map (the member's own sign-up, not friends). */
export interface ActivityDay {
  date: string; // Pacific YYYY-MM-DD
  code: string;
  title: string;
  location: string;
  /** done = came, absent = signed up but marked absent, upcoming = not happened yet. */
  status: "done" | "absent" | "upcoming";
}

export interface MemberProfile {
  id: string;
  username: string;
  wechatNickname: string;
  /** The member's own contact email, else their Google account's; null when neither. */
  email: string | null;
  emailFromGoogle: boolean;
  /** When they were let in (approval time; sign-up time for the Owner and older records). */
  joinedAt: string;
  activity: ActivityDay[];
  /** Only in the admin's view. */
  adminNote?: string;
}

export interface MeResponse {
  id: string;
  username: string;
  wechatNickname: string;
  isOwner: boolean;
  /** False for a disabled member: the page only shows bills. */
  active: boolean;
}

export type EventStatus = "open" | "closed" | "finalized" | "settled" | "cancelled";

export interface EventSummary {
  id: number;
  code: string;
  date: string; // Pacific YYYY-MM-DD
  startTime: string; // Pacific HH:MM
  endTime: string;
  location: string; // venue name
  address: string; // street address, may be empty for older events
  title: string; // optional, e.g. "HappyTuesday 比赛"; "" when not set
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
  dunningStopped: boolean;
}

export interface MyEvent extends EventSummary {
  /** null when not signed up; otherwise the names entered for each friend ("" = unnamed). */
  myFriends: string[] | null;
  canEdit: boolean;
  /** Present once the event is finalized and the member owes something. */
  payment: MyPayment | null;
  /** Everyone signed up, friends right after the member who brought them; only for members who signed up themselves. */
  roster: MyRosterEntry[] | null;
}

/** 我的活动: current and open events in full, newest first, and the paid-up past ones in brief. */
export interface MyEventsResponse {
  events: MyEvent[];
  history: MyHistoryEvent[];
  friendCap: number;
}

/** 历史活动: an event that is over and paid up. */
export interface MyHistoryEvent {
  id: number;
  code: string;
  date: string;
  title: string;
  location: string;
  /** Their bill (friends included); null when they were not billed. */
  amountCents: number | null;
  attended: boolean;
  friends: number;
}

export interface MyRosterEntry {
  name: string;
  /** For a friend: the member who brought them. */
  friendOf: string | null;
  /** The viewing member or one of their own friends. */
  mine: boolean;
  /** Marked absent at settlement (only reported once the event is finalized). */
  absent: boolean;
}

export interface EventDefaults {
  startTime: string;
  endTime: string;
  location: string;
  deadlineDays: number;
  deadlineHours: number;
  address: string; // of the last venue
  locations: { name: string; address: string }[]; // recent venues, newest first
  friendCap: number;
}

export interface HomeResponse {
  currentEvents: EventSummary[];
  pastEvents: EventSummary[];
  leaderboard: Leaderboard | null; // null when the Owner hides it
}

export interface RankEntry {
  name: string;
  value: number;
}

/** 公开排行榜 (members only, no money). */
export interface Leaderboard {
  year: number;
  attendance: RankEntry[]; // this year
  streak: RankEntry[]; // longest consecutive run, all time
  friends: RankEntry[]; // friends brought this year
}

/** 个人统计, shown only on the member's own page. */
export interface MyStats {
  year: number;
  yearCount: number;
  totalCount: number;
  yearSpendCents: number;
  avgSpendCents: number;
  /** Same period last year: Jan 1 up to today's month-day. */
  lastYearCount: number;
  lastYearSpendCents: number;
  /** Today in Pacific time, so the page's ranges line up with the server's. */
  today: string;
  /** Every counted event they came to or were billed for, oldest first. */
  history: SpendEntry[];
}

/** One event in 我的统计: its date, the member's bill (friends included) and whether they came. */
export interface SpendEntry {
  date: string; // Pacific YYYY-MM-DD
  title: string;
  location: string;
  cents: number;
  attended: boolean;
}

/** What anyone can see about an event: no names, just the head count. */
export type PublicEvent = EventSummary;

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

/** One address suggestion; Google ones carry an id resolved to the full address when picked. */
export interface AddressSuggestion {
  id: string | null;
  place: string; // business name, e.g. "Bay Badminton Center", or "" for plain addresses
  label: string; // address text shown (and used directly when there is no id)
}
