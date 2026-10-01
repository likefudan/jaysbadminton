import type { EventSummary } from "../shared/types";
import { STATUS_ZH } from "../shared/types";
import { formatDateZh, formatInstantZh } from "../shared/time";

export function EventInfo(props: { e: EventSummary; showStatus?: boolean }) {
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
      <div class="muted">📍 {e.location}</div>
      {e.status === "open" && <div class="muted small">报名截止：{formatInstantZh(e.deadlineAt)}</div>}
      <div class="small">已报名 {e.headcount} 人（含朋友）</div>
    </div>
  );
}

export function EventLink(props: { e: EventSummary; href: string }) {
  return (
    <a class="event-link" href={props.href}>
      <EventInfo e={props.e} />
      <span class="chevron">›</span>
    </a>
  );
}
