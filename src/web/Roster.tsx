import { offsetOf } from "../shared/stay";
import type { MyRosterEntry } from "../shared/types";
import { t } from "./i18n";
import { StayChart, stayText } from "./Stay";

/**
 * 名单 on a member's own event card: everyone signed up, each member followed by the friends they
 * bring. Shown only to members on the list; open while the event is upcoming.
 */
export function RosterList(props: {
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
  return (
    <details class="roster-fold" open={props.open}>
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
