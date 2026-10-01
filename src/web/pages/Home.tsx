import type { HomeResponse } from "../../shared/types";
import { Card, Empty, Load, Page } from "../components";
import { EventLink } from "../events";
import { useApi } from "../hooks";
import { useSiteTitle } from "../site";
import { LeaderboardCard } from "../Stats";

export function Home() {
  const [home] = useApi<HomeResponse>("/api/public/home");
  return (
    <Page title={useSiteTitle()}>
      <Load result={home}>
        {(data) => (
          <>
            <Card title="近期活动">
              {data.currentEvents.length === 0 && <Empty>暂时没有活动</Empty>}
              {data.currentEvents.map((e) => (
                <EventLink key={e.id} e={e} href={`/e/${e.code}`} publicView />
              ))}
            </Card>
            {data.leaderboard && <LeaderboardCard board={data.leaderboard} />}
            <Card title="历史活动">
              {data.pastEvents.length === 0 && <Empty>还没有历史活动</Empty>}
              {data.pastEvents.map((e) => (
                <EventLink key={e.id} e={e} href={`/e/${e.code}`} publicView />
              ))}
            </Card>
          </>
        )}
      </Load>
      <a class="button secondary block" href="/join">
        申请加入
      </a>
    </Page>
  );
}
