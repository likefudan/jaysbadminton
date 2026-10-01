import { Card, Empty, Load, Page } from "../components";
import { useApi } from "../hooks";

interface HomeData {
  openEvents: unknown[];
  pastEvents: unknown[];
  leaderboard: unknown[];
}

export function Home() {
  const [home] = useApi<HomeData>("/api/public/home");
  return (
    <Page title="每周羽毛球">
      <Load result={home}>
        {(data) => (
          <>
            <Card title="近期活动">{data.openEvents.length === 0 && <Empty>暂时没有开放报名的活动</Empty>}</Card>
            <Card title="出勤排行榜">{data.leaderboard.length === 0 && <Empty>还没有出勤记录</Empty>}</Card>
            <Card title="历史活动">{data.pastEvents.length === 0 && <Empty>还没有历史活动</Empty>}</Card>
          </>
        )}
      </Load>
      <a class="button secondary block" href="/join">
        申请加入
      </a>
    </Page>
  );
}
