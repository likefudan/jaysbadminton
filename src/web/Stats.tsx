import { useState } from "preact/hooks";
import { dollars } from "../shared/settle";
import { RANGES, bucketTitle, niceScale, summarize, type BucketUnit, type RangeId } from "../shared/spending";
import { formatDateZh } from "../shared/time";
import type { Leaderboard, MyStats, RankEntry } from "../shared/types";
import { Card, Empty, Load, SectionTitle } from "./components";
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
      <div class="seg">
        {BOARDS.map((x) => (
          <button key={x.key} class={x.key === tab ? "on" : ""} onClick={() => setTab(x.key)}>
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
              <span class="bar">
                <i style={{ width: `${Math.max(4, (r.value / (list[0]!.value || 1)) * 100)}%` }} />
              </span>
              <span class="value">
                {r.value}
                <small>{b.unit}</small>
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
  return <Load result={res}>{(s) => (s.history.length === 0 ? null : <SpendingCard stats={s} />)}</Load>;
}

const RANGE_KEY = "my-spend-range";
const RANGE_NAMES: Record<RangeId, string> = {
  "7D": "最近 7 天",
  "30D": "最近 30 天",
  "3M": "最近 3 个月",
  "6M": "最近 6 个月",
  "1Y": "最近 1 年",
  YTD: "今年",
  ALL: "全部",
};

function savedRange(): RangeId {
  try {
    const r = localStorage.getItem(RANGE_KEY);
    return (RANGES as readonly string[]).includes(r ?? "") ? (r as RangeId) : "YTD";
  } catch {
    return "YTD";
  }
}

/**
 * 我的统计: pick a range, see how often they played and what it cost, with one column per day,
 * week, month or year. Tapping a column shows its numbers; 明细 lists the events behind them.
 */
function SpendingCard(props: { stats: MyStats }) {
  const [range, setRange] = useState<RangeId>(savedRange);
  const [picked, setPicked] = useState<number | null>(null);
  const sum = summarize(props.stats.history, range, props.stats.today);
  const { top, step } = niceScale(Math.max(...sum.buckets.map((b) => b.cents)));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).reverse();
  const labelEvery = Math.ceil(sum.buckets.length / 7);
  const shown = picked !== null ? sum.buckets[picked] : undefined;

  function choose(r: RangeId) {
    setRange(r);
    setPicked(null);
    try {
      localStorage.setItem(RANGE_KEY, r);
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }

  return (
    <>
      <SectionTitle>我的统计</SectionTitle>
      <Card class="spend">
        <div class="seg spend-ranges" role="group" aria-label="时间范围">
          {RANGES.map((r) => (
            <button
              key={r}
              class={r === range ? "on" : ""}
              aria-pressed={r === range}
              title={RANGE_NAMES[r]}
              onClick={() => choose(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div class="spend-figures">
          <div>
            <span class="tile-label">打球</span>
            <span class="tile-value">
              {sum.count}
              <small>次</small>
            </span>
          </div>
          <div>
            <span class="tile-label">花费</span>
            <span class="tile-value">${dollars(sum.cents)}</span>
          </div>
          <div>
            <span class="tile-label">平均每次</span>
            <span class="tile-value">{sum.avgCents === null ? "—" : `$${dollars(sum.avgCents)}`}</span>
          </div>
        </div>
        <p class="spend-readout" aria-live="polite">
          {shown ? (
            <>
              <strong>{bucketTitle(shown, sum.unit)}</strong> · 花费 ${dollars(shown.cents)} · 打球 {shown.count} 次
            </>
          ) : (
            <span class="muted">
              {RANGE_NAMES[range]}每{UNIT_ZH[sum.unit]}的花费，点柱子看详情
            </span>
          )}
        </p>
        <div class="spend-chart">
          <div class="spend-axis" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t}>${t / 100}</span>
            ))}
          </div>
          <div class="spend-plot">
            {ticks.map((t) => (
              <i key={t} class="spend-grid" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
            <div class="spend-cols" onPointerLeave={(e) => e.pointerType === "mouse" && setPicked(null)}>
              {sum.buckets.map((b, i) => (
                <button
                  key={b.start}
                  class={`spend-col${picked === i ? " on" : ""}${picked !== null && picked !== i ? " dim" : ""}`}
                  aria-label={`${bucketTitle(b, sum.unit)}：花费 $${dollars(b.cents)}，打球 ${b.count} 次`}
                  onClick={() => setPicked(i)}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setPicked(i)}
                >
                  {b.cents > 0 && <span class="spend-bar" style={{ height: `${(b.cents / top) * 100}%` }} />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div class="spend-labels" aria-hidden="true">
          {sum.buckets.map((b, i) => (
            <span key={b.start}>{i % labelEvery === 0 ? b.label : ""}</span>
          ))}
        </div>
        {sum.entries.length > 0 ? (
          <details class="fold spend-detail">
            <summary>明细（{sum.entries.length} 场）</summary>
            <table>
              <tbody>
                {[...sum.entries].reverse().map((e, i) => (
                  <tr key={`${e.date}-${i}`}>
                    <td>{formatDateZh(e.date, e.date.slice(0, 4) !== props.stats.today.slice(0, 4))}</td>
                    <td class="muted">
                      {e.title || e.location}
                      {!e.attended && <span class="spend-absent"> · 缺席</span>}
                    </td>
                    <td class="num">${dollars(e.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : (
          <p class="muted small">{RANGE_NAMES[range]}没有打球记录。</p>
        )}
        <p class="muted small">花费按你的账单计算，包含你带的朋友；缺席的场次仍要分摊场地费。</p>
      </Card>
    </>
  );
}

const UNIT_ZH: Record<BucketUnit, string> = { day: "天", week: "周", month: "月", year: "年" };
