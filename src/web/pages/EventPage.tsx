import type { PublicEvent } from "../../shared/types";
import { formatDateZh } from "../../shared/time";
import { Card, Empty, Load, Page } from "../components";
import { EventInfo } from "../events";
import { useApi } from "../hooks";

export function EventPage(props: { code?: string }) {
  const [ev] = useApi<PublicEvent>(`/api/public/events/${props.code}`);
  return (
    <Load result={ev}>
      {(e) => (
        <Page title={`${formatDateZh(e.date)} 羽毛球`}>
          <Card>
            <EventInfo e={e} />
          </Card>
          <Card title={`报名名单（${e.roster.length}）`}>
            {e.roster.length === 0 && <Empty>还没有人报名</Empty>}
            <ul class="names">
              {e.roster.map((r, i) => (
                <li key={i} class={(r.isFriend ? "friend " : "") + (e.showAttendance && !r.attended ? "absent" : "")}>
                  {r.name}
                </li>
              ))}
            </ul>
            {e.showAttendance && <p class="muted small">划线的是报名了但没到场的。</p>}
          </Card>
          <p class="muted small">报名请用你自己的专属链接。还没有链接？</p>
          <a class="button secondary block" href="/join">
            申请加入
          </a>
          <a class="button secondary block" href="/">
            所有活动
          </a>
        </Page>
      )}
    </Load>
  );
}
