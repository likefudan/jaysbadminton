import type { EventSummary, HomeResponse } from "../../shared/types";
import { Empty, Load, Page, SectionTitle, Tiles } from "../components";
import { EventLink } from "../events";
import { useApi, useMemberSession } from "../hooks";
import { useSiteTitle } from "../site";
import { siteCardText } from "../../shared/shareCard";
import { ShareCardButton } from "../ShareCard";
import { LeaderboardCard } from "../Stats";
import { t, weekdayOf } from "../i18n";

/** 下次活动 / 已报名 / 近期活动, from the events already on the page. */
function overview(events: EventSummary[]) {
  const next = events.find((e) => e.status === "open") ?? events[0];
  if (!next) return null;
  const [, m, d] = next.date.split("-").map(Number) as [number, number, number];
  const weekday = weekdayOf(next.date);
  return [
    { label: t("下次活动"), value: `${m}/${d}`, sub: `${weekday} ${next.startTime}` },
    { label: t("已报名"), value: next.headcount, unit: t("人") },
    { label: t("近期活动"), value: events.length, unit: t("场") },
  ];
}

export function Home() {
  const [home] = useApi<HomeResponse>("/api/public/home");
  const member = useMemberSession();
  return (
    <Page title={useSiteTitle()} subtitle={t("登录后报名、查看活动和账单。")}>
      <a class="button block" href="/me">
        {member === "member" || member === "pending" ? t("我的活动") : t("登录 / 注册")}
      </a>
      <Load result={home}>
        {(data) => {
          const tiles = overview(data.currentEvents);
          return (
            <>
              {tiles && <Tiles items={tiles} />}
              <SectionTitle>{t("近期活动")}</SectionTitle>
              <div class="card list">
                {data.currentEvents.length === 0 && <Empty>{t("暂时没有活动")}</Empty>}
                {data.currentEvents.map((e) => (
                  <EventLink key={e.id} e={e} href={`/e/${e.code}`} publicView />
                ))}
              </div>
              {data.leaderboard && <LeaderboardCard board={data.leaderboard} />}
              <SectionTitle>{t("历史活动")}</SectionTitle>
              <div class="card list past">
                {data.pastEvents.length === 0 && <Empty>{t("还没有历史活动")}</Empty>}
                {data.pastEvents.map((e) => (
                  <EventLink key={e.id} e={e} href={`/e/${e.code}`} publicView />
                ))}
              </div>
              <ShareCardButton text={siteCardText(location.origin, t)} filename="share-card.png" />
            </>
          );
        }}
      </Load>
    </Page>
  );
}
