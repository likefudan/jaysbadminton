import { toPacific } from "../shared/time";
import { type BotLang, botDate } from "./botLang";
import type { EventRow } from "./events";

// How notices (Telegram and push) name an event. WeChat texts and pushes use the default, 简体.

/** "HappyTuesday 比赛 2026年10月7日 周三", or just the date when there is no title. */
export const day = (e: EventRow, l: BotLang = "zh-CN") =>
  e.title ? `${e.title} ${botDate(l, e.date)}` : botDate(l, e.date);
export const when = (e: EventRow, l: BotLang = "zh-CN") =>
  `${day(e, l)} ${toPacific(e.start_at).time}–${toPacific(e.end_at).time}`;
export const venue = (e: EventRow, l: BotLang = "zh-CN") =>
  `${e.location}${e.address ? (l === "en" ? ` (${e.address})` : `（${e.address}）`) : ""}`;
