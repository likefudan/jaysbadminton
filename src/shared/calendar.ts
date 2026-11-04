import { formatInstantZh, pacificToUtc } from "./time";
import type { EventSummary } from "./types";

/** What goes into a calendar entry for an event: name, UTC times, place and a few notes. */
export interface CalendarEntry {
  uid: string;
  title: string;
  startUtc: string; // ISO
  endUtc: string;
  location: string;
  details: string;
  url: string;
}

export function calendarEntry(e: EventSummary, origin: string): CalendarEntry {
  const url = `${origin}/e/${e.code}`;
  const host = new URL(origin).host;
  return {
    uid: `event-${e.id}@${host}`,
    title: e.title ? `${e.title}（羽毛球）` : "羽毛球",
    startUtc: pacificToUtc(e.date, e.startTime),
    endUtc: pacificToUtc(e.date, e.endTime),
    location: e.address ? `${e.location}, ${e.address}` : e.location,
    details: [
      `场馆：${e.location}`,
      ...(e.address ? [`地址：${e.address}`] : []),
      ...(e.noDeadline ? [] : [`报名截止：${formatInstantZh(e.deadlineAt)}`]),
      url,
    ].join("\n"),
    url,
  };
}

/** 20261006T020000Z */
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Google Calendar's "add event" page, prefilled. */
export function googleCalendarUrl(c: CalendarEntry): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: c.title,
    dates: `${stamp(c.startUtc)}/${stamp(c.endUtc)}`,
    location: c.location,
    details: c.details,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** RFC 5545 text: backslash, semicolon, comma and newlines escaped. */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets continue on the next line after a space, never splitting a character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** A one-event .ics file, with a reminder two hours before. */
export function icsFile(c: CalendarEntry, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//jaysbadminton//calendar//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${c.uid}`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(c.startUtc)}`,
    `DTEND:${stamp(c.endUtc)}`,
    `SUMMARY:${text(c.title)}`,
    `LOCATION:${text(c.location)}`,
    `DESCRIPTION:${text(c.details)}`,
    `URL:${c.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${text(c.title)}`,
    "TRIGGER:-PT2H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
