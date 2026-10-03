import type { EventSummary, HomeResponse } from "../../shared/types";
import { Empty, Load, Page, SectionTitle, Tiles } from "../components";
import { EventLink } from "../events";
import { useApi, useMemberSession } from "../hooks";
import { useSiteTitle } from "../site";
import { siteCardText } from "../../shared/shareCard";
import { ShareCardButton } from "../ShareCard";
import { LeaderboardCard } from "../Stats";

const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 下次活动 / 已报名 / 近期活动, from the events already on the page. */
function overview(events: EventSummary[]) {
  const next = events.find((e) => e.status === "open") ?? events[0];
  if (!next) return null;
  const [y, m, d] = next.date.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAY_ZH[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  return [
    { label: "下次活动", value: `${m}/${d}`, sub: `${weekday} ${next.startTime}` },
    { label: "已报名", value: next.headcount, unit: "人" },
    { label: "近期活动", value: events.length, unit: "场" },
  ];
}

export function Home() {
  const [home] = useApi<HomeResponse>("/api/public/home");
  const member = useMemberSession();
  return (
    <Page title={useSiteTitle()} subtitle="登录后报名、查看活动和账单。">
      <a class="button block" href="/me">
        {member === "member" || member === "pending" ? "我的活动" : "登录 / 注册"}
      </a>
      <Load result={home}>
        {(data) => {
          const tiles = overview(data.currentEvents);
          return (
            <>
              {tiles && <Tiles items={tiles} />}
              <SectionTitle>近期活动</SectionTitle>
              <div class="card list">
                {data.currentEvents.length === 0 && <Empty>暂时没有活动</Empty>}
                {data.currentEvents.map((e) => (
                  <EventLink key={e.id} e={e} href={`/e/${e.code}`} publicView />
                ))}
              </div>
              {data.leaderboard && <LeaderboardCard board={data.leaderboard} />}
              <SectionTitle>历史活动</SectionTitle>
              <div class="card list past">
                {data.pastEvents.length === 0 && <Empty>还没有历史活动</Empty>}
                {data.pastEvents.map((e) => (
                  <EventLink key={e.id} e={e} href={`/e/${e.code}`} publicView />
                ))}
              </div>
              <ShareCardButton text={siteCardText(location.origin)} filename="share-card.png" />
            </>
          );
        }}
      </Load>
    </Page>
  );
}
