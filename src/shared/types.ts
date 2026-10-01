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
