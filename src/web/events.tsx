import type { EventStatus, EventSummary } from "../shared/types";
import { STATUS_ZH } from "../shared/types";
import type { ComponentChildren } from "preact";
import { toPacific } from "../shared/time";
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

/** "10/27" from a Pacific YYYY-MM-DD. */
export function monthDay(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${m}/${d}`;
}

/** 今天 16:30 / 明天 16:30, else the full date and time. */
export function deadlineText(iso: string): string {
  const p = toPacific(iso);
  const today = toPacific(new Date()).date;
  const tomorrow = toPacific(new Date(Date.now() + 86_400_000)).date;
  if (p.date === today) return t("今天 {time}", { time: p.time });
  if (p.date === tomorrow) return t("明天 {time}", { time: p.time });
  return fmtInstant(iso);
}

/**
 * The top of an event card, as on the home page: status, deadline, a big date, then name · venue.
 * `tone` colours it: hero (accent), soft (light accent) or plain.
 */
export function EventHero(props: {
  e: EventSummary;
  status: { cls: string; label: string } | null;
  children?: ComponentChildren;
}) {
  const e = props.e;
  return (
    <>
      <span class="hero-top">
        {props.status ? <StatusPill cls={props.status.cls} label={props.status.label} /> : <span />}
        {e.status === "open" && <span>{t("截止 {time}", { time: deadlineText(e.deadlineAt) })}</span>}
      </span>
      <span class="hero-date">
        {monthDay(e.date)}
        <small>
          {weekdayOf(e.date)} {e.startTime}
        </small>
      </span>
      <span class="hero-what">
        {e.title || e.location}
        {e.title && <small> · {e.location}</small>}
      </span>
      {props.children}
    </>
  );
}

/** A small card in a sideways row: date, name, and one line underneath (headcount or what they paid). */
export function MiniEventCard(props: {
  e: { code: string; date: string; title: string; location: string };
  line: ComponentChildren;
  muted?: boolean;
}) {
  const e = props.e;
  return (
    <a class={props.muted ? "mini-card muted-card" : "mini-card"} href={`/e/${e.code}`}>
      <span class="mini-date">
        {monthDay(e.date)}
        <small>{weekdayOf(e.date)}</small>
      </span>
      <span class="mini-title">{e.title || e.location}</span>
      <span class="mini-line">{props.line}</span>
    </a>
  );
}
