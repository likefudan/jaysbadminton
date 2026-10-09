import { formatDateZh, toPacific } from "../shared/time";
import type { EventRow } from "./events";

// How notices (Telegram and push) name an event.

/** "HappyTuesday 比赛 2026年10月7日 周三", or just the date when there is no title. */
export const day = (e: EventRow) => (e.title ? `${e.title} ${formatDateZh(e.date)}` : formatDateZh(e.date));
export const when = (e: EventRow) => `${day(e)} ${toPacific(e.start_at).time}–${toPacific(e.end_at).time}`;
export const venue = (e: EventRow) => `${e.location}${e.address ? `（${e.address}）` : ""}`;
