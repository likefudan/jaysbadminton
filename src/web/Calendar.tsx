import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { calendarEntry, googleCalendarUrl } from "../shared/calendar";
import type { EventSummary } from "../shared/types";
import { t } from "./i18n";

const inWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

/** 加入日历 makes sense until the event is over, cancelled or settled. */
export function canAddToCalendar(e: EventSummary): boolean {
  if (e.status === "cancelled" || e.status === "settled") return false;
  return Date.parse(calendarEntry(e, location.origin).endUtc) >= Date.now();
}

/**
 * 加入日历 as one button that opens a short menu: an .ics file (Apple 日历, Outlook) or Google
 * Calendar, with time, venue and address. `icon` draws it as a calendar icon for the top corner of
 * an event card, next to the share icon; otherwise it is a pill in the card's action row.
 */
export function CalendarButton(props: { e: EventSummary; icon?: boolean }) {
  const e = props.e;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const outside = (ev: PointerEvent) => !box.current?.contains(ev.target as Node) && setOpen(false);
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const entry = calendarEntry(e, location.origin);
  const close = () => setOpen(false);
  return (
    <span class={props.icon ? "cal-box cal-corner" : "cal-box"} ref={box}>
      <button
        class={props.icon ? "share-icon" : "calendar-link cal-pill"}
        type="button"
        aria-label={props.icon ? t("加入日历") : undefined}
        title={props.icon ? t("加入日历") : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width={props.icon ? 17 : 15} height={props.icon ? 17 : 15} aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
        {!props.icon && t("加入日历")}
      </button>
      {open && (
        <span class="cal-menu" role="menu">
          {/* target="_top": opens in this tab like a plain link, but tells the app's router (preact-iso,
              which takes over every same-origin link) to leave it to the browser. */}
          <a role="menuitem" href={`/api/public/events/${e.code}/calendar.ics`} target="_top" onClick={close}>
            {t("Apple 日历 / Outlook")}
          </a>
          <a role="menuitem" href={googleCalendarUrl(entry)} target="_blank" rel="noreferrer" onClick={close}>
            {t("Google 日历")}
          </a>
          {inWeChat() && (
            <span class="muted small calendar-note">
              {t("微信里打不开日历的话，点右上角「···」选择「在浏览器中打开」。")}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
