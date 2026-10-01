import { useState } from "preact/hooks";
import { dollars } from "../shared/settle";
import type { Leaderboard, MyStats, RankEntry } from "../shared/types";
import { Card, Empty, Load } from "./components";
import { useApi } from "./hooks";

const BOARDS = [
  { key: "attendance", label: "出勤次数", unit: "次" },
  { key: "streak", label: "最长连续", unit: "场" },
  { key: "friends", label: "带朋友", unit: "人次" },
] as const;

/** 公开排行榜 with a small segmented switch between the three lists. */
export function LeaderboardCard(props: { board: Leaderboard }) {
  const [tab, setTab] = useState<(typeof BOARDS)[number]["key"]>("attendance");
  const b = BOARDS.find((x) => x.key === tab)!;
  const list: RankEntry[] = props.board[tab];
  return (
    <Card title={`${props.board.year} 年排行榜`}>
      <div class="tabs mini">
        {BOARDS.map((x) => (
          <button key={x.key} class={x.key === tab ? "active" : ""} onClick={() => setTab(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty>还没有出勤记录</Empty>
      ) : (
        <ol class="ranks">
          {list.map((r, i) => (
            <li key={r.name}>
              <span class={`place p${i + 1}`}>{i + 1}</span>
              <span class="who">{r.name}</span>
              <span class="value">
                {r.value} {b.unit}
              </span>
            </li>
          ))}
        </ol>
      )}
      {tab === "streak" && <p class="muted small">连续参加的活动场数，取消的活动不算。</p>}
    </Card>
  );
}

/** 个人统计: visible only on the member's own page. */
export function MyStatsCard(props: { base: string }) {
  const [res] = useApi<MyStats>(`${props.base}/stats`);
  return (
    <Load result={res}>
      {(s) =>
        s.totalCount === 0 ? null : (
          <Card title="我的统计">
            <div class="stats">
              <div>
                <strong>{s.yearCount}</strong>
                <small>今年来了（次）</small>
              </div>
              <div>
                <strong>{s.totalCount}</strong>
                <small>总共来了（次）</small>
              </div>
              <div>
                <strong>${dollars(s.yearSpendCents)}</strong>
                <small>今年花费</small>
              </div>
              <div>
                <strong>${dollars(s.avgSpendCents)}</strong>
                <small>平均每次</small>
              </div>
            </div>
            <p class="muted small">
              去年同期：来了 {s.lastYearCount} 次，花费 ${dollars(s.lastYearSpendCents)}
              {compare(s.yearCount, s.lastYearCount)}
            </p>
            <p class="muted small">花费按你的账单计算，包含你带的朋友。</p>
          </Card>
        )
      }
    </Load>
  );
}

function compare(now: number, before: number): string {
  if (before === 0) return now > 0 ? "。今年是新的开始！" : "";
  if (now > before) return `。今年多来了 ${now - before} 次 💪`;
  if (now < before) return `。比去年同期少 ${before - now} 次`;
  return "。和去年同期一样";
}
