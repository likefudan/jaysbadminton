import { formatDateZh } from "./time";
import type { EventSummary } from "./types";

/** The words on the 分享名片 image: the site's own card, or one event's. Never names. */
export interface CardText {
  heading: string; // the event's own title; "" for the site card or an untitled event
  lines: string[];
  hint: string;
  url: string;
}

const TAGLINE = "报名、结算、付款，一个链接搞定。";

export function siteCardText(origin: string): CardText {
  return { heading: "", lines: [TAGLINE], hint: "扫码查看活动、报名", url: `${origin}/` };
}

export function eventCardText(origin: string, e: EventSummary): CardText {
  const lines = [`${formatDateZh(e.date, false)} ${e.startTime}–${e.endTime}`, e.location];
  if (e.status === "cancelled") lines.unshift("本场已取消");
  return {
    heading: e.title,
    lines: lines.filter(Boolean),
    hint: e.status === "open" ? "扫码报名" : "扫码查看活动",
    url: `${origin}/e/${e.code}`,
  };
}
