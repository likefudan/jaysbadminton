import type { PublicEvent } from "../../shared/types";
import { formatDateZh } from "../../shared/time";
import { Card, Load, Page } from "../components";
import { CalendarLinks } from "../Calendar";
import { EventInfo } from "../events";
import { useApi } from "../hooks";

/** The page shared in the WeChat group: when, where and how many, never who. */
export function EventPage(props: { code?: string }) {
  const [ev] = useApi<PublicEvent>(`/api/public/events/${props.code}`);
  return (
    <Load result={ev}>
      {(e) => (
        <Page title={e.title || formatDateZh(e.date, false)} eyebrow={`${e.date.slice(0, 4)} · 羽毛球活动`}>
          <Card>
            <EventInfo e={e} publicView />
            <CalendarLinks e={e} />
          </Card>
          <p class="muted small">使用 Google 账号登录后即可报名。</p>
          <a class="button block" href="/me">
            登录 / 我的活动
          </a>
          <a class="button secondary block" href="/">
            所有活动
          </a>
        </Page>
      )}
    </Load>
  );
}
