import { useState } from "preact/hooks";
import { offsetOf } from "../shared/stay";
import type { MyRosterEntry } from "../shared/types";
import { t } from "./i18n";
import { StayChart, stayText } from "./Stay";

/**
 * 名单 on a member's own event card: everyone signed up, each member followed by the friends they
 * bring. Shown only to members on the list. Folded by default, since a big list is a lot to scroll
 * past (Ke Li 2026-11-10). While the event is upcoming, opening or folding it is remembered on
 * this device for that event alone, so a refresh keeps the viewer's choice. Past events stay folded.
 */
export function RosterList(props: {
  /** The event, so each card's fold is remembered on its own. */
  eventId: string;
  roster: MyRosterEntry[];
  open: boolean;
  /** 在场时间: the event's start and end, and the viewer's own time. */
  start: string;
  end: string;
  mine: { arrive: string | null; leave: string | null } | null;
}) {
  // 在场时间: by arrival once anyone gave one, those without a time last. Friends share their
  // member's time, so a stable sort keeps them right after the member.
  const timed = props.roster.some((r) => r.arrive);
  const list = timed ? [...props.roster].sort((a, b) => key(props.start, a) - key(props.start, b)) : props.roster;
  const absent = list.filter((r) => r.absent).length;
  const [remembered, setRemembered] = useState(() => readOpen().includes(props.eventId));
  const open = props.open && remembered;
  return (
    <details
      class="roster-fold"
      open={open}
      onToggle={(ev) => {
        const now = (ev.currentTarget as HTMLDetailsElement).open;
        if (!props.open || now === open) return; // a past event, or the render that set it
        writeOpen(props.eventId, now);
        setRemembered(now);
      }}
    >
      <summary>
        {absent > 0
          ? t("名单（{n} 人，{absent} 人未到）", { n: list.length, absent })
          : t("名单（{n} 人）", { n: list.length })}
      </summary>
      {timed && <StayChart start={props.start} end={props.end} stays={stays(props.roster)} mine={props.mine} />}
      <ul class="names">
        {list.map((r, i) => (
          <li
            key={i}
            class={[r.friendOf ? "friend" : "", r.mine ? "mine" : "", r.absent ? "absent" : ""].join(" ").trim()}
          >
            {r.name}
            {r.friendOf && !r.name.startsWith(r.friendOf) && <small>{t("（{name}带）", { name: r.friendOf })}</small>}
            {r.mine && !r.friendOf && <small>{t("（我）")}</small>}
            {r.arrive && <span class="stay-tag">{stayText(r)}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

const key = (start: string, r: MyRosterEntry) => (r.arrive ? offsetOf(start, r.arrive) : Number.POSITIVE_INFINITY);
const stays = (list: MyRosterEntry[]) => list.map((r) => ({ arrive: r.arrive, leave: r.leave }));

/** Upcoming events whose 名单 the viewer left open, newest last, kept on this device only. */
const FOLD_KEY = "roster-open-events";
const FOLD_KEEP = 50; // old events drop off the front
function readOpen(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeOpen(eventId: string, open: boolean) {
  const ids = readOpen().filter((id) => id !== eventId);
  if (open) ids.push(eventId);
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(ids.slice(-FOLD_KEEP)));
    localStorage.removeItem("roster-open"); // the earlier one-for-all choice (#229)
  } catch {
    // Private mode or blocked storage: the choice still holds for this visit.
  }
}
