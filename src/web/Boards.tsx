import { useId, useState } from "preact/hooks";
import type { BoardKey, Leaderboard, RankEntry } from "../shared/types";
import { Avatar } from "./Avatar";
import { kcalText } from "./Calories";
import { Empty, SectionTitle } from "./components";
import { t, tk } from "./i18n";

/** Each board's tab name, unit and one line on what it counts; in the order of BOARD_KEYS. */
export const BOARDS: Record<BoardKey, { label: string; unit: string; desc: string }> = {
  calories: { label: tk("能量"), unit: tk("千卡"), desc: tk("从 iPhone「健康」读取的活动能量，在「个人信息」里加入") },
  attendance: { label: tk("出勤"), unit: tk("次"), desc: tk("来打球的次数") },
  hours: { label: tk("时长"), unit: tk("小时"), desc: tk("按报名时填的到/走时间算，没填按整场") },
  progress: { label: tk("进步"), unit: tk("次"), desc: tk("比去年同期多来了几次") },
  streak: { label: tk("连续"), unit: tk("场"), desc: tk("连续参加活动的最长场数") },
  friends: { label: tk("带朋友"), unit: tk("人次"), desc: tk("带朋友来打球的人次") },
  queue: { label: tk("排队功臣"), unit: tk("次"), desc: tk("帮大家添加球馆账号、登记场地排队") },
  early: { label: tk("早鸟"), unit: tk("次"), desc: tk("开放报名后前 5 个报名、并且来了的次数") },
  likes: { label: tk("点赞"), unit: tk("个赞"), desc: tk("活动结束后，一起打球的人给的赞") },
};

export type Period = "year" | "month";

/** A board's list for the period: the year's are the top-level ones. */
export const listOf = (b: Leaderboard, key: BoardKey, period: Period): RankEntry[] =>
  period === "year" ? b[key] : b.monthly[key];

/** How a board writes a value: 千卡 with thousands commas, hours to one decimal, 进步 with a plus. */
export function valueText(key: BoardKey, v: number): string {
  if (key === "calories") return kcalText(v);
  if (key === "progress") return `+${v}`;
  return String(v);
}

/** 月度 / 年度 beside the title: 月度 first and shown first (Ke Li 2026-11-15). */
export function PeriodSwitch(props: { period: Period; set: (p: Period) => void }) {
  return (
    <span class="seg tiny period-seg" role="group">
      {(["month", "year"] as const).map((p) => (
        <button type="button" key={p} class={props.period === p ? "on" : ""} onClick={() => props.set(p)}>
          {p === "year" ? t("年度") : t("月度")}
        </button>
      ))}
    </span>
  );
}

export function boardTitle(b: Leaderboard, period: Period) {
  return period === "year"
    ? t("{year} 年排行榜", { year: b.year })
    : t("{year} 年 {month} 月排行榜", { year: b.year, month: b.month });
}

/** How many show before 查看全部: the podium plus three rows. */
const SHOWN = 6;

/** The heart's outline on a 100 × 94 grid, point at the bottom. */
const HEART =
  "M50 90C22 70 4 52 4 31C4 15 16 4 30 4C39 4 46 9 50 17C54 9 61 4 70 4C84 4 96 15 96 31C96 52 78 70 50 90Z";
/** Seen from above at a slant, the heart's top face is squashed to this share of its height. */
const SLANT = 0.42;
/** How tall each place's block stands, in hundredths of its width. */
const HEART_RISE: Record<number, number> = { 1: 58, 2: 40, 3: 27 };

/**
 * 点赞榜's step (Ke Li 2026-11-18, option G): a pink block whose top face is a heart, seen at a
 * slant, with the place number on its front. The sides are the top heart, the same heart moved
 * down, and the band between their widest points, which together are the block's outline.
 */
function HeartStep(props: { rank: number }) {
  const id = useId();
  const rise = HEART_RISE[props.rank] ?? HEART_RISE[3]!;
  const top = `matrix(1 0 0 ${SLANT} 0 0)`;
  const wide = 31 * SLANT; // the heart is widest a third of the way down
  const tip = 90 * SLANT;
  const height = tip + rise + 8;
  const first = props.rank === 1;
  return (
    <span class="step heart-step">
      <svg viewBox={`0 0 100 ${height}`} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}s`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color={first ? "#99163f" : "#c2255c"} />
            <stop offset=".5" stop-color={first ? "#e64980" : "#f06595"} />
            <stop offset="1" stop-color={first ? "#99163f" : "#c2255c"} />
          </linearGradient>
          <linearGradient id={`${id}t`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color={first ? "#ff9fbe" : "#ffd0de"} />
            <stop offset="1" stop-color={first ? "#ec5b8f" : "#f9a3bf"} />
          </linearGradient>
          <radialGradient id={`${id}f`}>
            <stop offset="0" class="heart-shade" />
            <stop offset="1" stop-color="#000" stop-opacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="50" cy={tip * 0.85 + rise + 2} rx="50" ry={tip * 0.32} fill={`url(#${id}f)`} />
        <g fill={`url(#${id}s)`}>
          <path d={HEART} transform={top} />
          <path d={HEART} transform={`matrix(1 0 0 ${SLANT} 0 ${rise})`} />
          <rect x="4" y={wide} width="92" height={rise} />
        </g>
        <path d={HEART} transform={top} fill={`url(#${id}t)`} />
        <path
          d={HEART}
          transform={top}
          fill="none"
          stroke="#fff"
          stroke-opacity=".55"
          stroke-width="1.2"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <b style={{ top: `${((tip + rise / 2 - 5) / height) * 100}%` }}>{props.rank}</b>
    </span>
  );
}

/**
 * One board (Ke Li picked the podium): the top three on steps, 1st in the middle with a crown,
 * the rest as rows below. 点赞 stands them on heart-shaped blocks instead, with no crown.
 */
export function BoardCard(props: { boardKey: BoardKey; list: RankEntry[] }) {
  const [all, setAll] = useState(false);
  const { boardKey: key, list } = props;
  const b = BOARDS[key];
  if (list.length === 0)
    return <Empty>{key === "calories" ? t("还没有人加入能量榜") : t("这段时间还没有人上榜")}</Empty>;
  const value = (v: number) => (
    <span class="value">
      {valueText(key, v)}
      <small>{t(b.unit)}</small>
    </span>
  );
  // 头像 only reach signed-in members; visitors see the names alone, laid out as before.
  const withFaces = list.some((r) => r.avatar !== undefined);
  // 2nd, 1st, 3rd from left to right; a missing place stays an empty column.
  const podium = [list[1], list[0], list[2]];
  const rest = list.slice(3, all ? undefined : SHOWN);
  const hearts = key === "likes";
  return (
    <div class={`card board${hearts ? " hearts" : ""}`}>
      <ol class="podium">
        {podium.map((r, i) =>
          r ? (
            // The rank is in the key: Android's Chrome kept a moved step's old look when only its
            // p1/p2/p3 class changed (app on the home screen: the saved list first, then the fresh one).
            <li key={`${r.name}:${r.rank}`} class={`place p${r.rank}`}>
              {r.rank === 1 && !hearts && (
                <span class="crown" aria-hidden="true">
                  👑
                </span>
              )}
              {withFaces && <Avatar src={r.avatar} size={r.rank === 1 ? 56 : 46} class="podium-av" />}
              <span class="who">{r.name}</span>
              {value(r.value)}
              {hearts ? <HeartStep rank={r.rank} /> : <span class="step">{r.rank}</span>}
            </li>
          ) : (
            <li key={`empty${i}`} class="place empty" aria-hidden="true" />
          ),
        )}
      </ol>
      {rest.length > 0 && (
        <ol class="board-rows">
          {rest.map((r) => (
            <li key={r.name}>
              <span class="rank-no">{r.rank}</span>
              {withFaces && <Avatar src={r.avatar} size={30} />}
              <span class="who">{r.name}</span>
              {value(r.value)}
            </li>
          ))}
        </ol>
      )}
      {list.length > SHOWN && (
        <button type="button" class="board-more" onClick={() => setAll(!all)}>
          {all ? t("收起") : t("查看全部 {n} 人", { n: list.length })}
        </button>
      )}
    </div>
  );
}

/**
 * 首页排行榜 (Ke Li 2026-11-10, option A): the public boards as a row of tabs that scrolls
 * sideways, 月度 / 年度 beside the title, one line on what the board counts.
 */
export function Leaders(props: { board: Leaderboard }) {
  const keys = props.board.boards;
  const [tab, setTab] = useState<BoardKey>(keys[0]!);
  const [period, setPeriod] = useState<Period>("month");
  const key = keys.includes(tab) ? tab : keys[0]!;
  return (
    <>
      <SectionTitle more={<PeriodSwitch period={period} set={setPeriod} />}>
        {boardTitle(props.board, period)}
      </SectionTitle>
      <div class="board-tabs" role="tablist">
        {keys.map((k) => (
          <button
            type="button"
            role="tab"
            aria-selected={k === key}
            key={k}
            class={k === key ? "on" : ""}
            onClick={(e) => {
              setTab(k);
              (e.currentTarget as HTMLElement).scrollIntoView({
                block: "nearest",
                inline: "nearest",
                behavior: "smooth",
              });
            }}
          >
            {t(BOARDS[k].label)}
          </button>
        ))}
      </div>
      <p class="board-desc">
        {key === "progress" && period === "month" ? t("比上个月同期多来了几次") : t(BOARDS[key].desc)}
      </p>
      <BoardCard key={`${key}-${period}`} boardKey={key} list={listOf(props.board, key, period)} />
    </>
  );
}
