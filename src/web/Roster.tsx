import type { MyRosterEntry } from "../shared/types";
import { t } from "./i18n";

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
        {absent > 0
          ? t("名单（{n} 人，{absent} 人未到）", { n: list.length, absent })
          : t("名单（{n} 人）", { n: list.length })}
      </summary>
      <ul class="names">
        {list.map((r, i) => (
          <li
            key={i}
            class={[r.friendOf ? "friend" : "", r.mine ? "mine" : "", r.absent ? "absent" : ""].join(" ").trim()}
          >
            {r.name}
            {r.friendOf && !r.name.startsWith(r.friendOf) && <small>{t("（{name}带）", { name: r.friendOf })}</small>}
            {r.mine && !r.friendOf && <small>{t("（我）")}</small>}
          </li>
        ))}
      </ul>
    </details>
  );
}
