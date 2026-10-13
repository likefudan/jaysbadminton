import type { EventStatus, EventSummary } from "../shared/types";
import { STATUS_ZH } from "../shared/types";
import { fmtDate, fmtInstant, t, tx, weekdayOf } from "./i18n";

/** Apple Maps on iPhone, Google Maps elsewhere. */
export function mapLink(address: string): string {
  const q = encodeURIComponent(address);
  return /iPhone|iPad|Macintosh/.test(navigator.userAgent)
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/**
 * What the public sees: only whether sign-up is open, plus 已取消; nothing about money
 * (finalized and settled events read as 已截止 or show no badge at all once in the past).
 */
function publicStatus(s: EventStatus): { cls: string; label: string } | null {
  if (s === "open") return { cls: "open", label: t("报名中") };
  if (s === "closed" || s === "finalized") return { cls: "closed", label: t("已截止") };
  if (s === "cancelled") return { cls: "cancelled", label: t("已取消") };
  return null;
}

/** The calendar block on the left of an event: year, month/day, weekday. */
export function DateTile(props: { date: string }) {
  const [y, m, d] = props.date.split("-").map(Number) as [number, number, number];
  const weekday = weekdayOf(props.date);
  return (
    <div class="date-tile" role="img" aria-label={fmtDate(props.date)}>
      <span class="dt-year">{y}</span>
      <span class="dt-day">
        {m}/{d}
      </span>
      <span class="dt-week">{weekday}</span>
    </div>
  );
}

export function StatusPill(props: { cls: string; label: string }) {
  return (
    <span class={`status status-${props.cls}`}>
      <i />
      {props.label}
    </span>
  );
}

export function EventInfo(props: {
  e: EventSummary;
  showStatus?: boolean;
  inLink?: boolean;
  publicView?: boolean;
  status?: { cls: string; label: string }; // overrides the event status, e.g. a member's own bill
  /** Who runs it, e.g. 组织：A on a member's card or 负责人：A on the Owner's list; never on public pages. */
  runBy?: string;
}) {
  const e = props.e;
  const badge =
    props.status ?? (props.publicView ? publicStatus(e.status) : { cls: e.status, label: t(STATUS_ZH[e.status]) });
  return (
    <div class="event-info">
      <DateTile date={e.date} />
      <div class="ev-body">
        {e.title && <div class="event-name">{e.title}</div>}
        <div class="ev-line">
          {e.startTime}–{e.endTime} · <span class="venue">{e.location}</span>
        </div>
        {e.address &&
          (props.inLink ? (
            <div class="ev-meta address">{e.address}</div>
          ) : (
            <a class="ev-meta address" href={mapLink(e.address)} target="_blank" rel="noreferrer">
              {e.address} ↗
            </a>
          ))}
        {props.runBy && <div class="ev-meta">{props.runBy}</div>}
        {e.notes?.trim() && <div class="ev-meta event-notes">{e.notes}</div>}
        {e.status === "open" && <div class="ev-meta">{t("报名截止 {time}", { time: fmtInstant(e.deadlineAt) })}</div>}
        <div class="ev-foot">
          {props.showStatus !== false && badge ? <StatusPill cls={badge.cls} label={badge.label} /> : <span />}
          <span class="count">{tx("{n} 人已报名", { n: <b>{e.headcount}</b> })}</span>
        </div>
      </div>
    </div>
  );
}

export function EventLink(props: { e: EventSummary; href: string; publicView?: boolean }) {
  return (
    <a class="event-link" href={props.href}>
      <EventInfo e={props.e} inLink publicView={props.publicView} />
      <span class="chevron">›</span>
    </a>
  );
}
