import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { calendarEntry, googleCalendarUrl, icsFile } from "../src/shared/calendar";
import type { EventSummary } from "../src/shared/types";
import { eventMeta, homeMeta, withShareMeta } from "../src/worker/share";
import { ORIGIN, createTestEvent, setUpAdmin } from "./helpers";

const get = (path: string) => exports.default.fetch(`${ORIGIN}${path}`);
const SHELL = `<!doctype html><html><head><title>Jay's 羽毛球</title>
<meta name="description" content="x" /><meta property="og:title" content="x" />
<meta property="og:description" content="x" /><meta property="og:image" content="x" /></head><body></body></html>`;

describe("link previews", () => {
  it("describes an event by title, date, time, venue and headcount — never names", async () => {
    const ctx = await setUpAdmin();
    const e = await createTestEvent(ctx, {
      title: "HappyTuesday 比赛",
      joinSelf: true,
      address: "1191 Montague Expy, Milpitas, CA 95035",
    });
    const meta = (await eventMeta(env, e.code))!;
    expect(meta.title).toMatch(/^HappyTuesday 比赛 · \d{4}年\d+月\d+日 周. 羽毛球 · Jay's 羽毛球$/);
    expect(meta.description).toMatch(/^19:00–21:00 · Bay Badminton Center · 已报名 1 人 · 报名截止 /);
    expect(meta.description).not.toContain("Jay ·");
    expect(meta.url).toBe(`https://jaysbadminton.llmat.dev/e/${e.code}`);
    expect(await eventMeta(env, "NOPE")).toBeNull();
    expect((await homeMeta(env)).title).toBe("Jay's 羽毛球");
  });

  it("writes the tags into the app shell, escaped", async () => {
    const meta = { title: `A "quoted" <title> & more`, description: "19:00 · 场馆", url: "https://example.com/e/1006" };
    const html = await withShareMeta(
      new Response(SHELL, { headers: { "Content-Type": "text/html" } }),
      meta,
      "https://example.com",
    ).text();
    // Text escapes markup, attributes escape quotes: nothing can break out of either.
    expect(html).toContain('<title>A "quoted" &lt;title&gt; &amp; more</title>');
    expect(html).toContain('<meta property="og:title" content="A &quot;quoted&quot; <title> & more" />');
    expect(html).toContain('<meta name="description" content="19:00 · 场馆" />');
    expect(html).toContain('<meta property="og:image" content="https://example.com/og-image.jpg" />');
    expect(html).toContain('<meta property="og:url" content="https://example.com/e/1006" />');
  });
});

describe("加入日历", () => {
  const e: EventSummary = {
    id: 7,
    code: "1006",
    date: "2026-10-06",
    startTime: "19:00",
    endTime: "21:00",
    location: "Bay Badminton Center",
    address: "1191 Montague Expy, Milpitas, CA 95035",
    title: "HappyTuesday 比赛",
    deadlineAt: "2026-10-06T02:00:00.000Z",
    status: "open",
    headcount: 8,
  };
  const entry = calendarEntry(e, "https://jaysbadminton.llmat.dev");

  it("puts time (Pacific → UTC), venue and address into an .ics file", () => {
    const ics = icsFile(entry, new Date("2026-10-01T00:00:00Z"));
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DTSTART:20261007T020000Z"); // 19:00 PDT
    expect(unfolded).toContain("DTEND:20261007T040000Z");
    expect(unfolded).toContain("SUMMARY:HappyTuesday 比赛（羽毛球）");
    expect(unfolded).toContain("LOCATION:Bay Badminton Center\\, 1191 Montague Expy\\, Milpitas\\, CA 95035");
    expect(unfolded).toContain("UID:event-7@jaysbadminton.llmat.dev");
    expect(unfolded).toContain("TRIGGER:-PT2H");
    // Every physical line fits in 75 octets.
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("prefills Google Calendar", () => {
    const u = new URL(googleCalendarUrl(entry));
    expect(u.searchParams.get("dates")).toBe("20261007T020000Z/20261007T040000Z");
    expect(u.searchParams.get("location")).toBe("Bay Badminton Center, 1191 Montague Expy, Milpitas, CA 95035");
    expect(u.searchParams.get("text")).toBe("HappyTuesday 比赛（羽毛球）");
  });

  it("serves the .ics for a public event code", async () => {
    const ctx = await setUpAdmin();
    const ev = await createTestEvent(ctx, { address: "4004 Wellness Way, San Jose, CA 95131" });
    const res = await get(`/api/public/events/${ev.code}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(await res.text()).toContain("4004 Wellness Way");
    expect((await get("/api/public/events/NOPE/calendar.ics")).status).toBe(404);
  });
});
