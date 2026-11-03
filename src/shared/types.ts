import type { PhotoUsage } from "./ai";
import type { QueueInfo } from "./courtQueue";
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
  /** The email they registered with or entered in 个人信息; links are sent here. */
  email?: string | null;
  applicantName?: string;
  wechatAccount?: string;
  /** 给群主的留言, written with the application; "" when none. */
  applicationMessage?: string;
  approvalEmailStatus?: string | null;
  /** The admin's own name for this person, to tell people apart (never shown to members). */
  adminNote: string;
  /** Still owed across all bills (only filled in for the admin's member list). */
  owingCents: number;
  /** A current 组织者 (only on the admin member list, and only while the feature is on). */
  isOrganizer?: boolean;
  /** A current 管理员 (likewise). */
  isAdmin?: boolean;
}

/** One row of the 组织者 block on the members page. */
export interface OrganizerInfo {
  id: string;
  username: string;
  /** 管理员 or 组织者: both run events and take payments into their own account. */
  role: "admin" | "organizer";
  /** 任命时间. */
  since: string | null;
  /** Venmo username and notification email both filled in (Finalize needs them). */
  paymentReady: boolean;
  /** The last Venmo email for their account: forwarding works (filled in from card 8). */
  lastVenmoEmailAt: string | null;
  /** Bills paying into their account out for days with no Venmo email for it: forwarding may be broken. */
  quietBills: number;
  telegram: boolean;
  /** Events they run that are not archived yet. */
  events: number;
}

export interface OrganizersBlock {
  /** May appoint, revoke and transfer (the Owner); organizers see the block read-only. */
  canManage: boolean;
  list: OrganizerInfo[];
  /** 历史收款人: revoked, but members still pay into their account for this many events. */
  former: { id: string; username: string; collecting: number }[];
}

/** What revoking an organizer does to one of their events that is not archived. */
export interface RevokeImpact {
  id: number;
  code: string;
  date: string;
  title: string;
  status: EventStatus;
  /**
   * to_owner: manager and payee go to the Owner; payee_stays: the Owner runs it, money still goes
   * to them; manager_only: only who runs it changes; payee_only: someone else runs it already and
   * nothing changes, but members still pay them; payee_to_owner: before Finalize, only the payee
   * was theirs and it goes to the Owner.
   */
  outcome: "to_owner" | "payee_stays" | "manager_only" | "payee_only" | "payee_to_owner";
}

export interface MembersResponse {
  pending: MemberSummary[];
  active: MemberSummary[];
  inactive: MemberSummary[]; // 已停用: can pay, cannot sign up
  deleted: MemberSummary[]; // 已删除: link gone, history kept
  /** Null while the 组织者 feature is off. */
  organizers: OrganizersBlock | null;
  /** Who is looking: the pages show an organizer only what they may do. */
  viewer: AdminViewer;
}

/** The person on the admin pages: the Owner, or an admin or organizer signed in with Google. */
export interface AdminViewer {
  /** Null only for the Owner before their member record exists. */
  id: string | null;
  role: "owner" | "admin" | "organizer";
  /** What they may do (ROLE_CAPABILITIES): pages check these rather than the role. */
  caps: Capability[];
}

/** What a role may do; see ROLE_CAPABILITIES in src/worker/organizers.ts. */
export type Capability = "owner" | "data" | "group" | "events.create" | "event" | "payee" | "members.read" | "self";

export interface LinkResponse {
  link: string;
}

/** Approving a request: a link to send, or none when they applied with Google and just sign in. */
export type ApprovalEmailStatus = "sent" | "failed" | "not_configured" | "not_needed";

export interface ApproveResponse {
  emailStatus?: ApprovalEmailStatus;
  link: string | null;
  googleEmail: string | null;
  /** Registered with email: where the link was sent. */
  email?: string | null;
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
  /** Signed in with Google as the Owner or an organizer: the page offers 管理页. */
  canAdmin: boolean;
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
  notes?: string; // optional multiline activity notes
  queueRoundMin: number | null; // 球场排队: minutes per round, null when off
  title: string; // optional, e.g. "HappyTuesday 比赛"; "" when not set
  deadlineAt: string; // UTC ISO
  status: EventStatus;
  headcount: number; // members + friends
}

/** The admin event list: each event with who runs it (the Owner filters by it). */
export interface AdminEventSummary extends EventSummary {
  manager: { id: string | null; name: string };
}

export interface RosterEntry {
  id: number;
  memberId: string;
  memberName: string;
  friendIndex: number; // 0 = the member
  name: string; // display name; friends without a name show as "<member>的朋友<n>"
  attended: boolean;
  addedByOwner: boolean;
  /** 带群友: the member paying for this one (who brought them); null when they pay for themselves. */
  paidBy: string | null;
  paidByName: string | null;
}

/** 预定场地: court numbers at the hall run 1–99 (Ke Li); a dozen is more than any event books. */
export const BOOKED_COURT_MAX = 99;
export const BOOKED_COURTS_MAX = 12;

export interface EventDetail extends EventSummary {
  /** 预定场地: the hall's court numbers booked for it, in order; empty until someone sets them. */
  courts: number[];
  roster: RosterEntry[];
  dunningStopped: boolean;
  /** 从数据库永久删除 is offered: the event is archived (all paid) or cancelled. */
  deletable: boolean;
  /** 收款人: walk-ins can be hung under them (their bill pays itself). */
  payee: { id: string | null; name: string; isMe: boolean };
  /** 负责人: who runs it, by name (the Owner's included). */
  manager: { id: string | null; name: string; isMe: boolean };
  /** 拍照登记用量: photos read, tokens and an estimated price; null when no photo was sent. */
  photoUsage: PhotoUsage | null;
}

/** 操作记录: one change to an event, newest first on the admin page. */
export interface AuditEntry {
  id: number;
  at: string;
  /** Who did it, by name (the Owner's included), or 系统 (auto-matching and archiving). */
  actor: string;
  action: string;
  detail: string;
}

/**
 * 选群友: a member who could be brought to an event. free: not on it; mine: brought by the viewer
 * already; on: on it themselves; brought: brought by someone else (`by`).
 */
export interface GuestChoice {
  id: string;
  name: string;
  state: "free" | "mine" | "on" | "brought";
  by: string | null;
}

export interface MyEvent extends EventSummary {
  /** null when not signed up; otherwise the names entered for each friend ("" = unnamed). */
  myFriends: string[] | null;
  /** 带群友: the group members they bring and pay for (count as friends towards the cap). */
  myGuests: { id: string; name: string }[];
  /**
   * Brought by another member who pays for them (带群友): who, whether that person's bill is out,
   * and whether it's paid. They are on the list (selfSignedUp) but have no bill of their own.
   */
  broughtBy: { name: string; billed: boolean; paid: boolean } | null;
  /** On the list themselves; false with myFriends set when the Owner hung friends under them without them. */
  selfSignedUp: boolean;
  canEdit: boolean;
  /** How many friends they may bring to this event (more for the person running it). */
  friendCap: number;
  /** 组织：the organizer running it; null when the Owner does (members see no name then, as before) or the viewer does. */
  organizer: string | null;
  /** The viewer runs it themselves (as the Owner or its organizer); only while the 组织者 feature is on. */
  runByMe: boolean;
  /** Who runs it, by name (the Owner's name on theirs): whom to contact about the event. */
  managerName: string;
  /** The Owner by name, who may also change any event's list from the admin page. */
  ownerName: string;
  /** Present once the event is finalized and the member owes something. */
  payment: MyPayment | null;
  /** Everyone signed up, friends right after the member who brought them; only for members who signed up themselves. */
  roster: MyRosterEntry[] | null;
  /** 球场排队: shared hall accounts and courts; only for players on the event while it is on. */
  queue: QueueInfo | null;
  /** 预定场地: the courts booked for it, for players on it and whoever runs it; empty otherwise or until set. */
  courts: number[];
  /** Their own 卡路里 for it from iPhone 「健康」; null until read. */
  kcal: number | null;
  /** 读取 is offered: they signed up themselves and it started less than 30 days ago. */
  kcalOpen: boolean;
  /** 读取 is offered but their Shortcut is older than the one the install link gives. */
  kcalUpdate: boolean;
  /** The Shortcut's iCloud link from 设置, while 读取 is offered; empty otherwise. */
  kcalInstall: string;
}

/** 读取卡路里: what the page hands the Shortcut. upload takes the number once, within 15 minutes. */
export interface CalorieStart {
  /** Pacific wall-clock "YYYY-MM-DD HH:mm" (Get Dates from Input reads it with the time); start includes the warm-up. */
  start: string;
  end: string;
  upload: string;
}

/** 我的卡路里 on 个人信息. */
export interface MyCalories {
  year: number;
  yearKcal: number;
  yearCount: number;
  /** On the 卡路里榜. */
  board: boolean;
  /** Every event read, newest first. */
  events: { code: string; date: string; title: string; location: string; kcal: number }[];
  /** 个人信息 → 卡路里快捷指令: the install link (empty when none is set), and whether theirs is an older version. */
  shortcut: { url: string; outdated: boolean };
}

/** 我的活动: current and open events in full, newest first, and the paid-up past ones in brief. */
export interface MyEventsResponse {
  events: MyEvent[];
  history: MyHistoryEvent[];
  friendCap: number;
}

/** One event on its own page (/e/:code); null when it isn't on 我的活动 (not theirs and not open). */
export interface MyEventResponse {
  event: MyEvent | null;
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
  /** Brought by this member, who paid for them (带群友); null otherwise. */
  paidBy: string | null;
  kcal: number | null;
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

/** A 最近的场馆 entry: its address, and the 排队系统 round length its last event used (null: off). */
export interface Venue {
  name: string;
  address: string;
  queueRoundMin: number | null;
}

export interface EventDefaults {
  startTime: string;
  endTime: string;
  location: string;
  deadlineDays: number;
  deadlineHours: number;
  address: string; // of the last venue
  locations: Venue[]; // recent venues, newest first
  friendCap: number;
}

export interface HomeResponse {
  currentEvents: EventSummary[];
  pastEvents: EventSummary[];
  leaderboard: Leaderboard | null; // null when the Owner hides it
}

export interface RankEntry {
  rank: number; // ties share a rank, the next one skips (1, 1, 1, 4)
  name: string;
  value: number;
}

/** 公开排行榜 (members only, no money). */
export interface Leaderboard {
  year: number;
  attendance: RankEntry[]; // this year
  streak: RankEntry[]; // longest consecutive run, all time
  friends: RankEntry[]; // friends brought this year
  calories: RankEntry[]; // 千卡 this year, members who chose to be on it
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
  method: "venmo" | "manual" | "refund"; // a refund has a negative amount
  payerName: string | null;
  receivedAt: string;
  /**
   * A Venmo payment linked from 待确认 that went into another account than the event's payee's
   * (钱在 某某 的账户): whose, by name. Null when it is where it should be.
   */
  elsewhere: string | null;
}

export interface PaymentRow {
  id: number;
  memberId: string;
  memberName: string;
  /** The bill of the event's payee (收款人), who pays themselves: always paid, nothing to mark or undo. */
  isPayee: boolean;
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
  /** The payee is whoever is looking (the Owner on their own events): their bill reads 我. */
  payeeIsMe: boolean;
}

export interface MyPayment {
  amountCents: number; // due
  paidCents: number;
  refundCents: number;
  status: PaymentStatus;
  code: string;
  shares: import("./settle").Share[];
  /** Who the money goes to, by name, the Owner's included (付给 …). */
  payeeName: string;
  /** The payee's accounts ("" when they have none). */
  venmoUsername: string;
  zelleAccount: string;
}

export type InboundKind = "unmatched"; // older rows may hold "anomaly" / "other" / "parse_failed"

/** A forwarded Venmo payment the Owner reviews (待确认), or one already handled. */
export interface InboundRow {
  id: number;
  kind: InboundKind;
  state: "open" | "linked" | "ignored" | "deleted";
  payerName: string | null;
  amountCents: number | null;
  note: string | null;
  receivedAt: string;
  txnId: string | null;
  /** Why it needs review, or what was done with it. */
  reason: string | null;
  linked: { paymentId: number; memberName: string; eventLabel: string } | null;
  /** Whose account it went into, when that is an organizer's (current or former); null for the Owner's. */
  payee: string | null;
  /** In 已删除: when it was deleted (UTC ISO); it is removed for good 30 days later. */
  deletedAt: string | null;
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
  /** The 30 latest linked to a bill. */
  done: InboundRow[];
  /** Every ignored one, until deleted, so a mistaken 忽略 can be moved back. */
  ignored: InboundRow[];
  deleted: InboundRow[];
  payments: OpenPayment[];
  refunds: RefundRow[];
}

/** One address suggestion; Google ones carry an id resolved to the full address when picked. */
export interface AddressSuggestion {
  id: string | null;
  place: string; // business name, e.g. "Bay Badminton Center", or "" for plain addresses
  label: string; // address text shown (and used directly when there is no id)
}
