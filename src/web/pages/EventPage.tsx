import type { PublicEvent } from "../../shared/types";
import { formatDateZh } from "../../shared/time";
import { Card, Load, Page } from "../components";
import { EventInfo } from "../events";
import { useApi } from "../hooks";

/** The page shared in the WeChat group: when, where and how many, never who. */
export function EventPage(props: { code?: string }) {
  const [ev] = useApi<PublicEvent>(`/api/public/events/${props.code}`);
  return (
    <Load result={ev}>
      {(e) => (
        <Page title={e.title || `${formatDateZh(e.date)} 羽毛球`}>
          <Card>
            <EventInfo e={e} publicView />
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
