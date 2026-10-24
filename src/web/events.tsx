import type { EventStatus, EventSummary, MyEvent } from "../shared/types";
import { STATUS_ZH } from "../shared/types";
import type { ComponentChildren } from "preact";
import { toPacific } from "../shared/time";
import { currentLang, fmtDate, fmtInstant, t, tx, weekdayOf } from "./i18n";

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
export function publicStatus(s: EventStatus): { cls: string; label: string } | null {
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

/**
 * The status of an event the member is on, with a tick for the dot (Ke Li): 我已报名 while open,
 * （已截止） once closed, （请付款） while their bill is unpaid, then 已付清. 朋友已报名 the same way
 * when only friends hung under them are on it. Someone brought by another member (带群友) sees
 * who: Ke 带我报名 → （已截止） → （Ke 付款） → Ke 已付清. Null when they're not on it, or it was cancelled.
 */
export function mineStatus(e: {
  status: EventStatus;
  selfSignedUp: boolean;
  myFriends?: string[] | null;
  myGuests?: { id: string }[];
  broughtBy?: { name: string; billed: boolean; paid: boolean } | null;
  payment?: { status: string } | null;
}): { cls: string; label: string } | null {
  if (e.status === "cancelled") return null;
  // Their own bill (friends the admin hung under them) comes first; otherwise the bringer's.
  const b = e.payment ? null : e.broughtBy;
  if (b) {
    if (b.paid) return { cls: "mine", label: t("{name} 已付清", { name: b.name }) };
    if (b.billed) return { cls: "mine", label: t("{name} 带我报名（{name} 付款）", { name: b.name }) };
    if (e.status === "open") return { cls: "mine", label: t("{name} 带我报名", { name: b.name }) };
    if (e.status === "closed" || e.status === "finalized")
      return { cls: "mine", label: t("{name} 带我报名（已截止）", { name: b.name }) };
    return null;
  }
  const who = e.selfSignedUp ? "me" : friendCount(e) > 0 ? "friends" : null;
  if (!who) return null;
  const mine = (me: string, friends: string) => ({ cls: "mine", label: who === "me" ? me : friends });
  if (e.payment?.status === "paid") return { cls: "mine", label: t("已付清") };
  if (e.payment) return mine(t("我已报名（请付款）"), t("朋友已报名（请付款）"));
  if (e.status === "open") return mine(t("我已报名"), t("朋友已报名"));
  if (e.status === "closed" || e.status === "finalized")
    return mine(t("我已报名（已截止）"), t("朋友已报名（已截止）"));
  return null;
}

/** Friends they bring, by name and group members (带群友) together. */
export const friendCount = (e: { myFriends?: string[] | null; myGuests?: { id: string }[] }) =>
  (e.myFriends?.length ?? 0) + (e.myGuests?.length ?? 0);

/**
 * On the event (themselves or friends under them) with nothing billed yet: the card keeps its
 * coral top (Ke Li). Brought by someone, until that person's bill is out.
 */
export const onCard = (e: MyEvent) => (e.selfSignedUp || friendCount(e) > 0) && !e.payment && !e.broughtBy?.billed;

/** 预定场地 on a player's card: 场地：3、5 号. */
export function CourtsLine(props: { courts: number[] }) {
  const list = props.courts.join(currentLang() === "en" ? ", " : "、");
  return <div class="ev-meta ev-courts">{tx("场地：{courts} 号", { courts: <b>{list}</b> })}</div>;
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
 * The top of an event card, as on the home page: status and deadline, a big date, then name · venue.
 * `action` (the share icon) sits alone in the top right corner.
 */
export function EventHero(props: {
  e: EventSummary;
  status: { cls: string; label: string } | null;
  action?: ComponentChildren;
  children?: ComponentChildren;
}) {
  const e = props.e;
  return (
    <>
      <span class="hero-top">
        {props.status ? <StatusPill cls={props.status.cls} label={props.status.label} /> : <span />}
        {e.status === "open" && <span>{t("截止 {time}", { time: deadlineText(e.deadlineAt) })}</span>}
        {props.action}
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
