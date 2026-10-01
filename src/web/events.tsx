import type { EventStatus, EventSummary } from "../shared/types";
import { STATUS_ZH } from "../shared/types";
import { formatDateZh, formatInstantZh } from "../shared/time";

/** Apple Maps on iPhone, Google Maps elsewhere. */
export function mapLink(address: string): string {
  const q = encodeURIComponent(address);
  return /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/**
 * What the public sees: only whether sign-up is open, plus 已取消; nothing about money
 * (finalized and settled events read as 已截止 or show no badge at all once in the past).
 */
function publicStatus(s: EventStatus): { cls: string; label: string } | null {
  if (s === "open") return { cls: "open", label: "报名中" };
  if (s === "closed" || s === "finalized") return { cls: "closed", label: "已截止" };
  if (s === "cancelled") return { cls: "cancelled", label: "已取消" };
  return null;
}

export function EventInfo(props: { e: EventSummary; showStatus?: boolean; inLink?: boolean; publicView?: boolean }) {
  const e = props.e;
  const badge = props.publicView ? publicStatus(e.status) : { cls: e.status, label: STATUS_ZH[e.status] };
  return (
    <div class="event-info">
      {e.title && <div class="event-name">{e.title}</div>}
      <div class="event-title">
        <strong>{formatDateZh(e.date)}</strong>
        <span class="muted">
          {" "}
          {e.startTime}–{e.endTime}
        </span>
        {props.showStatus !== false && badge && <span class={`status status-${badge.cls}`}>{badge.label}</span>}
      </div>
      <div class="venue">📍 {e.location}</div>
      {e.address &&
        (props.inLink ? (
          <div class="muted small address">{e.address}</div>
        ) : (
          <a class="small address" href={mapLink(e.address)} target="_blank" rel="noreferrer">
            {e.address} ↗
          </a>
        ))}
      {e.status === "open" && <div class="muted small">报名截止：{formatInstantZh(e.deadlineAt)}</div>}
      <div class="small">已报名 {e.headcount} 人（含朋友）</div>
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
