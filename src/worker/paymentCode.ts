import { pinyin } from "pinyin-pro";

/**
 * Venmo note for a bill: "<name>-jbm<yyyymmdd><suffix>-m<number>", all lowercase,
 * e.g. "xiaoming-jbm20261007-m002" or, for a second event that day, "...-jbm20261007b-m002".
 * The jbm and m parts identify the bill; the name must also belong to someone in the group,
 * which filters out the Owner's unrelated Venmo payments (see inbound.ts).
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
  /** The name part as typed, lowercased, e.g. "xiaoming"; null when the note has none. */
  name: string | null;
  /** Pacific event date YYYY-MM-DD. */
  date: string;
  /** Event code as stored on events, e.g. "1007" or "1007B". */
  eventCode: string;
  memberId: string; // "M002"
}

const CODE = /(?:([a-z0-9_]+)\s*-\s*)?jbm\s*(\d{4})(\d{2})(\d{2})([a-z]?)\s*-\s*m(\d+)/i;

/** Finds a payment code anywhere in a Venmo note; tolerant of case and stray spaces. */
export function parsePaymentCode(note: string): ParsedCode | null {
  const m = CODE.exec(note);
  if (!m) return null;
  const [, name, y, mo, d, suffix, num] = m;
  return {
    name: name ? name.toLowerCase() : null,
    date: `${y}-${mo}-${d}`,
    eventCode: `${mo}${d}${suffix!.toUpperCase()}`,
    memberId: `M${num!.padStart(3, "0")}`,
  };
}

/** The name part of a stored payment code. */
export const codeName = (code: string) => code.slice(0, code.lastIndexOf("-jbm"));

/** "jbm20261007" or "jbm20261007b": how an event is named in notes, messages and exports. */
export const eventNumber = (eventDate: string, eventCode: string) => `jbm${eventDate.replace(/-/g, "")}${suffixOf(eventCode)}`;
