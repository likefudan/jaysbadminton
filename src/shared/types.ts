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
