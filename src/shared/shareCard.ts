import { formatDateZh } from "./time";
import type { EventSummary } from "./types";

/** The words on the 分享名片 image: the site's own card, or one event's. Never names. */
export interface CardText {
  heading: string; // the event's own title; "" for the site card or an untitled event
  lines: string[];
  hint: string;
  url: string;
}

/** The card's own words in the visitor's language (the web's t); Chinese by default. */
type Words = (zh: string) => string;
const zh: Words = (s) => s;

export function siteCardText(origin: string, tr: Words = zh): CardText {
  return { heading: "", lines: [], hint: tr("扫码查看活动、报名"), url: `${origin}/` };
}

export function eventCardText(
  origin: string,
  e: EventSummary,
  tr: Words = zh,
  date: (d: string) => string = (d) => formatDateZh(d, false),
): CardText {
  const lines = [`${date(e.date)} ${e.startTime}–${e.endTime}`, e.location];
  if (e.status === "cancelled") lines.unshift(tr("本场已取消"));
  return {
    heading: e.title,
    lines: lines.filter(Boolean),
    hint: e.status === "open" ? tr("扫码报名") : tr("扫码查看活动"),
    url: `${origin}/e/${e.code}`,
  };
}
