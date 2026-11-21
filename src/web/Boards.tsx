import { useState } from "preact/hooks";
import type { BoardKey, Leaderboard, RankEntry } from "../shared/types";
import { Avatar } from "./Avatar";
import { kcalText } from "./Calories";
import { Empty, SectionTitle } from "./components";
import { t, tk } from "./i18n";
import { HeartIcon } from "./Likes";

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

/**
 * The boards with the quiet podium (Ke Li 2026-11-21, option B): each has its own small sign and
 * colour, deep for 1st, lighter for 2nd and 3rd. 能量 is blue sweat (her words), 出勤 a green tick,
 * 点赞 a heart in the three reds she chose on 2026-11-18. The other boards keep the crown and the
 * numbered steps.
 */
const QUIET: Partial<Record<BoardKey, [string, string, string]>> = {
  calories: ["#2b7cbf", "#57a2dc", "#92c5ec"],
  attendance: ["#2c8a68", "#52ab89", "#8bcab0"],
  likes: ["#c01730", "#e8488c", "#f4707f"],
};
/** A quiet step's height in px for 1st, 2nd, 3rd; 点赞 goes by likes instead (heartStepHeight). */
const QUIET_STEPS = [62, 44, 32];
/** 1st place's step on 点赞榜 is this tall, in px; the others as tall as their share of 1st's likes. */
const HEART_STEP = 70;
/** The shortest a step gets, so 3rd place still reads as a step (Ke Li 2026-11-20, option C). */
const HEART_STEP_MIN = 24;

/** How tall a 点赞榜 step stands: its share of 1st place's likes, but never under HEART_STEP_MIN. */
export function heartStepHeight(value: number, top: number): number {
  const share = top > 0 ? Math.min(1, value / top) : 1;
  return Math.max(HEART_STEP_MIN, Math.round(HEART_STEP * share));
}

/** The small sign on a quiet step: two drops of sweat, a tick in a disc, or a heart. */
function StepIcon(props: { boardKey: BoardKey; size: number }) {
  return (
    <svg class="step-icon" viewBox="0 0 24 24" width={props.size} height={props.size} aria-hidden="true">
      {props.boardKey === "calories" ? (
        <g fill="currentColor">
          <path d="M10 3c2.6 3.6 5.6 6.6 5.6 10.4a5.6 5.6 0 0 1-11.2 0C4.4 9.6 7.4 6.6 10 3z" />
          <path d="M18.6 3.500c1.1 1.6 2.4 2.9 2.4 4.500a2.4 2.4 0 0 1-4.8 0c0-1.6 1.3-2.9 2.4-4.500z" />
        </g>
      ) : props.boardKey === "attendance" ? (
        <>
          <circle cx="12" cy="12" r="9.5" fill="currentColor" />
          <path
            d="M8 12.3l2.8 2.800L16.2 9.5"
            fill="none"
            stroke="#fff"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </>
      ) : (
        <path
          fill="currentColor"
          d="M12 20.500s-7.5-4.6-9.2-9.400C1.6 7.6 3.9 4 7.4 4c2 0 3.6 1.1 4.6 2.700C13 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.400z"
        />
      )}
    </svg>
  );
}

/**
 * A quiet step (Ke Li 2026-11-21, option B, after she found 点赞榜's heart-shaped blocks too big):
 * it fades out downward, has a thin line in the place's colour along its top, and the board's
 * small sign set into the line. No number on it; screen readers still hear the place.
 */
function QuietStep(props: { boardKey: BoardKey; tones: [string, string, string]; rank: number; height: number }) {
  return (
    <span
      class="step quiet-step"
      style={{ height: `${props.height}px`, "--tone": props.tones[props.rank - 1] ?? props.tones[2] }}
    >
      <StepIcon boardKey={props.boardKey} size={props.rank === 1 ? 22 : 18} />
      <span class="sr-only">{props.rank}</span>
    </span>
  );
}

/**
 * One board (Ke Li picked the podium): the top three on steps, 1st in the middle with a crown,
 * the rest as rows below. 能量, 出勤 and 点赞 have quiet steps with a small sign instead, and no crown.
 */
export function BoardCard(props: { boardKey: BoardKey; list: RankEntry[] }) {
  const [all, setAll] = useState(false);
  const { boardKey: key, list } = props;
  const b = BOARDS[key];
  if (list.length === 0)
    return <Empty>{key === "calories" ? t("还没有人加入能量榜") : t("这段时间还没有人上榜")}</Empty>;
  const hearts = key === "likes";
  const tones = QUIET[key];
  // 点赞榜 (Ke Li 2026-11-20): the podium shows the bare number, the rows the number and a heart.
  const value = (v: number, row = false) =>
    hearts ? (
      <span class="value">
        {valueText(key, v)}
        {row && <HeartIcon size={14} />}
      </span>
    ) : (
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
  return (
    <div class={`card board${hearts ? " hearts" : ""}${tones ? ` quiet quiet-${key}` : ""}`}>
      <ol class="podium">
        {podium.map((r, i) =>
          r ? (
            // The rank is in the key: Android's Chrome kept a moved step's old look when only its
            // p1/p2/p3 class changed (app on the home screen: the saved list first, then the fresh one).
            <li key={`${r.name}:${r.rank}`} class={`place p${r.rank}`}>
              {r.rank === 1 && !tones && (
                <span class="crown" aria-hidden="true">
                  👑
                </span>
              )}
              {withFaces && <Avatar src={r.avatar} size={r.rank === 1 ? 56 : 46} class="podium-av" />}
              <span class="who">{r.name}</span>
              {value(r.value)}
              {tones ? (
                <QuietStep
                  boardKey={key}
                  tones={tones}
                  rank={r.rank}
                  height={hearts ? heartStepHeight(r.value, list[0]!.value) : (QUIET_STEPS[r.rank - 1] ?? 32)}
                />
              ) : (
                <span class="step">{r.rank}</span>
              )}
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
              {value(r.value, true)}
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
export function Leaders(props: {
  board: Leaderboard;
  /** Where 「我的上榜设置 ›」 goes (个人信息 › 设置 › 排行榜); none for visitors. */
  mine?: string;
}) {
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
      {props.mine && (
        <p class="board-mine">
          <a href={props.mine}>{t("我的上榜设置 ›")}</a>
        </p>
      )}
    </>
  );
}
