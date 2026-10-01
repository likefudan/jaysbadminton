import { pinyin } from "pinyin-pro";

/**
 * Venmo note for a bill: "<name>-jbm<yyyymmdd><suffix>-m<number>", all lowercase,
 * e.g. "xiaoming-jbm20261007-m002" or, for a second event that day, "...-jbm20261007b-m002".
 * Only the jbm and m parts identify the bill; the name is there so the Owner recognises
 * payments in Venmo, so a rename or an odd pinyin reading never breaks matching.
 */

/** Chinese to toneless pinyin, letters lowercased, spaces and dashes to "_", anything else dropped. */
export function noteName(username: string): string {
  const latin = pinyin(username, { toneType: "none", type: "array", nonZh: "consecutive" }).join("");
  const name = latin
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return name || "member";
}

/** "1007B" → "b", "1007" → "". */
const suffixOf = (eventCode: string) => eventCode.slice(4).toLowerCase();

export function paymentCode(username: string, eventDate: string, eventCode: string, memberId: string): string {
  return `${noteName(username)}-jbm${eventDate.replace(/-/g, "")}${suffixOf(eventCode)}-${memberId.toLowerCase()}`;
}

export interface ParsedCode {
  /** Pacific event date YYYY-MM-DD, or null for legacy codes that only carry MMDD. */
  date: string | null;
  /** Event code as stored on events, e.g. "1007" or "1007B". */
  eventCode: string;
  memberId: string; // "M002"
}

const CURRENT = /jbm\s*(\d{4})(\d{2})(\d{2})([a-z]?)\s*-\s*m(\d+)/i;
const LEGACY = /BM\s*(\d{4})([A-Z]?)\s*-\s*M(\d+)/i;

/** Finds a payment code anywhere in a Venmo note; tolerant of case and stray spaces. */
export function parsePaymentCode(note: string): ParsedCode | null {
  const m = CURRENT.exec(note);
  if (m) {
    const [, y, mo, d, suffix, num] = m;
    return {
      date: `${y}-${mo}-${d}`,
      eventCode: `${mo}${d}${suffix!.toUpperCase()}`,
      memberId: `M${num!.padStart(3, "0")}`,
    };
  }
  const l = LEGACY.exec(note);
  if (l) return { date: null, eventCode: `${l[1]}${l[2]!.toUpperCase()}`, memberId: `M${l[3]!.padStart(3, "0")}` };
  return null;
}
