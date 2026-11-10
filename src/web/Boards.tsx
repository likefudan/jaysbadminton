import { useState } from "preact/hooks";
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

/** 年度 / 月度 beside the title. */
export function PeriodSwitch(props: { period: Period; set: (p: Period) => void }) {
  return (
    <span class="seg tiny period-seg" role="group">
      {(["year", "month"] as const).map((p) => (
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
 * One board (Ke Li picked the podium): the top three on steps, 1st in the middle with a crown,
 * the rest as rows below.
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
  return (
    <div class="card board">
      <ol class="podium">
        {podium.map((r, i) =>
          r ? (
            <li key={r.name} class={`place p${r.rank}`}>
              {r.rank === 1 && (
                <span class="crown" aria-hidden="true">
                  👑
                </span>
              )}
              {withFaces && <Avatar src={r.avatar} size={r.rank === 1 ? 56 : 46} class="podium-av" />}
              <span class="who">{r.name}</span>
              {value(r.value)}
              <span class="step">{r.rank}</span>
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
 * sideways, 年度 / 月度 beside the title, one line on what the board counts.
 */
export function Leaders(props: { board: Leaderboard }) {
  const keys = props.board.boards;
  const [tab, setTab] = useState<BoardKey>(keys[0]!);
  const [period, setPeriod] = useState<Period>("year");
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
