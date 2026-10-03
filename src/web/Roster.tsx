import type { MyRosterEntry } from "../shared/types";

/**
 * 名单 on a member's own event card: everyone signed up, each member followed by the friends they
 * bring. Shown only to members on the list; open while the event is upcoming.
 */
export function RosterList(props: { roster: MyRosterEntry[]; open: boolean }) {
  const list = props.roster;
  const absent = list.filter((r) => r.absent).length;
  return (
    <details class="roster-fold" open={props.open}>
      <summary>
        名单（{list.length} 人{absent > 0 && `，${absent} 人未到`}）
      </summary>
      <ul class="names">
        {list.map((r, i) => (
          <li
            key={i}
            class={[r.friendOf ? "friend" : "", r.mine ? "mine" : "", r.absent ? "absent" : ""].join(" ").trim()}
          >
            {r.name}
            {r.friendOf && !r.name.startsWith(r.friendOf) && <small>（{r.friendOf}带）</small>}
            {r.mine && !r.friendOf && <small>（我）</small>}
          </li>
        ))}
      </ul>
    </details>
  );
}
