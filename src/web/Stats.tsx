import { useState } from "preact/hooks";
import { dollars } from "../shared/settle";
import { RANGES, bucketTitle, niceScale, summarize, type BucketUnit, type RangeId } from "../shared/spending";
import type { Leaderboard, MyStats, RankEntry } from "../shared/types";
import { Card, Empty, Load, SectionTitle } from "./components";
import { useApi } from "./hooks";
import { dateText, fmtDate, t, tk } from "./i18n";

const BOARDS = [
  { key: "attendance", label: tk("出勤次数"), unit: tk("次") },
  { key: "streak", label: tk("最长连续"), unit: tk("场") },
  { key: "friends", label: tk("带朋友"), unit: tk("人次") },
] as const;

/** 公开排行榜 with a small segmented switch between the three lists. */
export function LeaderboardCard(props: { board: Leaderboard }) {
  const [tab, setTab] = useState<(typeof BOARDS)[number]["key"]>("attendance");
  const b = BOARDS.find((x) => x.key === tab)!;
  const list: RankEntry[] = props.board[tab];
  return (
    <Card title={t("{year} 年排行榜", { year: props.board.year })}>
      <div class="seg">
        {BOARDS.map((x) => (
          <button type="button" key={x.key} class={x.key === tab ? "on" : ""} onClick={() => setTab(x.key)}>
            {t(x.label)}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty>{t("还没有出勤记录")}</Empty>
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
                <small>{t(b.unit)}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      {tab === "streak" && <p class="muted small">{t("连续参加的活动场数，取消的活动不算。")}</p>}
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
  "7D": tk("最近 7 天"),
  "30D": tk("最近 30 天"),
  "3M": tk("最近 3 个月"),
  "6M": tk("最近 6 个月"),
  "1Y": tk("最近 1 年"),
  YTD: tk("今年"),
  ALL: tk("全部"),
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
      <SectionTitle>{t("我的统计")}</SectionTitle>
      <Card class="spend">
        <div class="seg spend-ranges" role="group" aria-label={t("时间范围")}>
          {RANGES.map((r) => (
            <button
              type="button"
              key={r}
              class={r === range ? "on" : ""}
              aria-pressed={r === range}
              title={t(RANGE_NAMES[r])}
              onClick={() => choose(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div class="spend-figures">
          <div>
            <span class="tile-label">{t("打球")}</span>
            <span class="tile-value">
              {sum.count}
              <small>{t("次")}</small>
            </span>
          </div>
          <div>
            <span class="tile-label">{t("花费")}</span>
            <span class="tile-value">${dollars(sum.cents)}</span>
          </div>
          <div>
            <span class="tile-label">{t("平均每次")}</span>
            <span class="tile-value">{sum.avgCents === null ? "—" : `$${dollars(sum.avgCents)}`}</span>
          </div>
        </div>
        <p class="spend-readout" aria-live="polite">
          {shown ? (
            <>
              <strong>{dateText(bucketTitle(shown, sum.unit))}</strong> ·{" "}
              {t("花费 {amount} · 打球 {n} 次", { amount: `$${dollars(shown.cents)}`, n: shown.count })}
            </>
          ) : (
            <span class="muted">{t(SPEND_HINT[sum.unit], { range: t(RANGE_NAMES[range]) })}</span>
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
                  type="button"
                  key={b.start}
                  class={`spend-col${picked === i ? " on" : ""}${picked !== null && picked !== i ? " dim" : ""}`}
                  aria-label={t("{when}：花费 {amount}，打球 {n} 次", {
                    when: dateText(bucketTitle(b, sum.unit)),
                    amount: `$${dollars(b.cents)}`,
                    n: b.count,
                  })}
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
            <span key={b.start}>{i % labelEvery === 0 ? dateText(b.label) : ""}</span>
          ))}
        </div>
        {sum.entries.length > 0 ? (
          <details class="fold spend-detail">
            <summary>{t("明细（{n} 场）", { n: sum.entries.length })}</summary>
            <table>
              <tbody>
                {[...sum.entries].reverse().map((e, i) => (
                  <tr key={`${e.date}-${i}`}>
                    <td>{fmtDate(e.date, e.date.slice(0, 4) !== props.stats.today.slice(0, 4))}</td>
                    <td class="muted">
                      {e.title || e.location}
                      {!e.attended && <span class="spend-absent"> · {t("缺席")}</span>}
                    </td>
                    <td class="num">${dollars(e.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : (
          <p class="muted small">{t("{range}没有打球记录。", { range: t(RANGE_NAMES[range]) })}</p>
        )}
        <p class="muted small">{t("花费按你的账单计算，包含你带的朋友；缺席的场次仍要分摊场地费。")}</p>
      </Card>
    </>
  );
}

/** 最近 30 天每天的花费…, one sentence per column size so each language can word it its own way. */
const SPEND_HINT: Record<BucketUnit, string> = {
  day: tk("{range}每天的花费，点柱子看详情"),
  week: tk("{range}每周的花费，点柱子看详情"),
  month: tk("{range}每月的花费，点柱子看详情"),
  year: tk("{range}每年的花费，点柱子看详情"),
};
