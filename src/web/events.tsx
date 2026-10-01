import type { EventSummary } from "../shared/types";
import { STATUS_ZH } from "../shared/types";
import { formatDateZh, formatInstantZh } from "../shared/time";

/** Apple Maps on iPhone, Google Maps elsewhere. */
export function mapLink(address: string): string {
  const q = encodeURIComponent(address);
  return /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function EventInfo(props: { e: EventSummary; showStatus?: boolean; inLink?: boolean }) {
  const e = props.e;
  return (
    <div class="event-info">
      <div class="event-title">
        <strong>{formatDateZh(e.date)}</strong>
        <span class="muted">
          {" "}
          {e.startTime}–{e.endTime}
        </span>
        {props.showStatus !== false && <span class={`status status-${e.status}`}>{STATUS_ZH[e.status]}</span>}
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

export function EventLink(props: { e: EventSummary; href: string }) {
  return (
    <a class="event-link" href={props.href}>
      <EventInfo e={props.e} inLink />
      <span class="chevron">›</span>
    </a>
  );
}
