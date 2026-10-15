import type { AdminViewer, Capability, RevokeImpact } from "../shared/types";
import { formatDateZh } from "../shared/time";

/** Whether the person on the admin pages may do this (the API enforces it; pages only hide what they may not). */
export const has = (viewer: AdminViewer, cap: Capability) => viewer.caps.includes(cap);

/**
 * The revoke (or step-down) confirmation: what happens to each of their events that is not
 * archived (design §8). `who` is 他 when the Owner revokes someone, 你 when an organizer steps down.
 */
export function revokeSummary(events: RevokeImpact[], who: "他" | "你" = "他"): string {
  if (events.length === 0) return `\n\n${who}没有未归档的活动。`;
  const own = events.some((e) => e.outcome === "to_owner" || e.outcome === "payee_to_owner")
    ? `\n\n还没结算的活动换了收款人以后，${who}本人和挂在${who}名下的朋友也要和别人一样付钱。`
    : "";
  const what: Record<RevokeImpact["outcome"], string> = {
    to_owner: "还没结算：负责人和收款人都转给群主",
    payee_stays: `收款中：由群主接手管理，钱继续付到${who}的账户，直到收齐`,
    manager_only: "收款中：负责人转给群主，收款人不变",
    payee_only: `收款中：负责人不变，钱继续付到${who}的账户，直到收齐`,
    payee_to_owner: "还没结算：收款人转给群主，负责人不变",
  };
  return `\n\n会受影响的活动：\n${events
    .map((e) => {
      const label =
        e.outcome === "manager_only" && e.status !== "finalized"
          ? "还没结算：负责人转给群主，收款人不变"
          : what[e.outcome];
      return `· ${formatDateZh(e.date, false)}${e.title ? ` ${e.title}` : ""}：${label}`;
    })
    .join("\n")}${own}`;
}
