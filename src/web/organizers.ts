import type { AdminViewer, Capability, RevokeImpact } from "../shared/types";
import { fmtDate, t } from "./lang";

/** Whether the person on the admin pages may do this (the API enforces it; pages only hide what they may not). */
export const has = (viewer: AdminViewer, cap: Capability) => viewer.caps.includes(cap);

/**
 * The revoke (or step-down) confirmation: what happens to each of their events that is not
 * archived (design §8). `self` when an organizer steps down (你), not when the Owner revokes someone (他).
 */
export function revokeSummary(events: RevokeImpact[], self = false): string {
  if (events.length === 0) return `\n\n${self ? t("你没有未归档的活动。") : t("他没有未归档的活动。")}`;
  const own = events.some((e) => e.outcome === "to_owner" || e.outcome === "payee_to_owner")
    ? `\n\n${
        self
          ? t("还没结算的活动换了收款人以后，你本人和挂在你名下的朋友也要和别人一样付钱。")
          : t("还没结算的活动换了收款人以后，他本人和挂在他名下的朋友也要和别人一样付钱。")
      }`
    : "";
  const what: Record<RevokeImpact["outcome"], string> = {
    to_owner: t("还没结算：负责人和收款人都转给群主"),
    payee_stays: self
      ? t("收款中：由群主接手管理，钱继续付到你的账户，直到收齐")
      : t("收款中：由群主接手管理，钱继续付到他的账户，直到收齐"),
    manager_only: t("收款中：负责人转给群主，收款人不变"),
    payee_only: self
      ? t("收款中：负责人不变，钱继续付到你的账户，直到收齐")
      : t("收款中：负责人不变，钱继续付到他的账户，直到收齐"),
    payee_to_owner: t("还没结算：收款人转给群主，负责人不变"),
  };
  const lines = events.map((e) => {
    const label =
      e.outcome === "manager_only" && e.status !== "finalized"
        ? t("还没结算：负责人转给群主，收款人不变")
        : what[e.outcome];
    return `· ${t("{what}：{label}", { what: `${fmtDate(e.date, false)}${e.title ? ` ${e.title}` : ""}`, label })}`;
  });
  return `\n\n${t("会受影响的活动：")}\n${lines.join("\n")}${own}`;
}
