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

/** A bill's code: the payer's name, the event's fixed number (events.number) and the member ID. */
export function paymentCode(username: string, eventNumber: string, memberId: string): string {
  return `${noteName(username)}-${eventNumber}-${memberId.toLowerCase()}`;
}

export interface ParsedCode {
  /** The name part as typed, lowercased, e.g. "xiaoming"; null when the note has none. */
  name: string | null;
  /** The event's number as stored on events.number, e.g. "jbm20261007" or "jbm20261007b". */
  number: string;
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
    number: `jbm${y}${mo}${d}${suffix!.toLowerCase()}`,
    memberId: `M${num!.padStart(3, "0")}`,
  };
}

/** The name part of a stored payment code. */
export const codeName = (code: string) => code.slice(0, code.lastIndexOf("-jbm"));

/**
 * 活动编号 for a new event on this date: "jbm20261007", then "jbm20261007b", "…c" for later events
 * that day, skipping every number already taken (by events, including ones moved to another date
 * since, and by deleted events). Null when the day has run out of letters.
 */
export function nextEventNumber(date: string, taken: Set<string>): string | null {
  const base = eventNumberBase(date);
  for (const suffix of ["", ..."bcdefghijklmnopqrstuvwxyz"]) {
    if (!taken.has(base + suffix)) return base + suffix;
  }
  return null;
}

/** "2026-10-07" → "jbm20261007": the number of the first event created for that date. */
export const eventNumberBase = (date: string) => `jbm${date.replace(/-/g, "")}`;

/** The old public event code for a number: month and day, plus the letter in capitals ("1007", "1007B"). */
export const codeOf = (eventNumber: string) => eventNumber.slice(7, 11) + eventNumber.slice(11).toUpperCase();

/**
 * The public event code (the /e/ link) of events created since 2026-11-04: the year's last two
 * digits, then codeOf ("26-1007", "26-1007B"), so it never comes round again the next year.
 */
export const yearCodeOf = (eventNumber: string) => `${eventNumber.slice(5, 7)}-${codeOf(eventNumber)}`;
