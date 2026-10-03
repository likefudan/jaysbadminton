import { calendarEntry, googleCalendarUrl } from "../shared/calendar";
import type { EventSummary } from "../shared/types";

const inWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

/** 加入日历 makes sense until the event is over, cancelled or settled. */
export function canAddToCalendar(e: EventSummary): boolean {
  if (e.status === "cancelled" || e.status === "settled") return false;
  return Date.parse(calendarEntry(e, location.origin).endUtc) >= Date.now();
}

/** 加入日历: an .ics file (iPhone, Outlook) and Google Calendar, with time, venue and address. */
export function CalendarButtons(props: { e: EventSummary }) {
  const e = props.e;
  const entry = calendarEntry(e, location.origin);
  return (
    <>
      {/* target="_top": opens in this tab like a plain link, but tells the app's router (preact-iso,
          which takes over every same-origin link) to leave it to the browser. */}
      <a class="calendar-link" href={`/api/public/events/${e.code}/calendar.ics`} target="_top">
        iPhone / Outlook
      </a>
      <a class="calendar-link" href={googleCalendarUrl(entry)} target="_blank" rel="noreferrer">
        Google 日历
      </a>
      {inWeChat() && (
        <p class="muted small calendar-note">微信里打不开日历的话，点右上角「···」选择「在浏览器中打开」。</p>
      )}
    </>
  );
}
