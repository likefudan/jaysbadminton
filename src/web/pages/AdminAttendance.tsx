import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type {
  AttendanceDetail,
  AttendanceStat,
  AttendanceWindow,
  MemberAttendanceResponse,
  MemberSummary,
} from "../../shared/types";
import { type ActivityLevel, activityLevel, attendanceRate } from "../../shared/attendance";
import { useApi } from "../hooks";
import { t } from "../i18n";

/**
 * 出勤统计 on the 成员 tab (Ke Li 2026-11-19, option A): each row shows how often the member came,
 * the 出勤率 and when they last came; chips filter 活跃 / 少来 / 不活跃; the member's page gets an
 * 「出勤」 card. The Owner and admins only. How it counts: worker/attendance.ts.
 */

export type Filter = ActivityLevel | "all";
export type Sort = "recent" | "count" | "rate" | "id";

const WINDOWS: { key: AttendanceWindow; label: () => string }[] = [
  { key: "30", label: () => t("近 30 天") },
  { key: "90", label: () => t("近 90 天") },
  { key: "year", label: () => t("今年") },
  { key: "all", label: () => t("全部") },
];
const SORTS: { key: Sort; label: () => string }[] = [
  { key: "recent", label: () => t("最近来过") },
  { key: "count", label: () => t("次数最多") },
  { key: "rate", label: () => t("出勤率最高") },
  { key: "id", label: () => t("入群先后") },
];
const LEVELS: { key: Filter; label: () => string }[] = [
  { key: "all", label: () => t("全部@members") },
  { key: "active", label: () => t("活跃") },
  { key: "quiet", label: () => t("少来") },
  { key: "inactive", label: () => t("不活跃") },
];

const WINDOW_KEY = "jb_attendance_window";
function savedWindow(): AttendanceWindow {
  try {
    const v = localStorage.getItem(WINDOW_KEY);
    if (WINDOWS.some((w) => w.key === v)) return v as AttendanceWindow;
  } catch {}
  return "90";
}
function saveWindow(w: AttendanceWindow) {
  try {
    localStorage.setItem(WINDOW_KEY, w);
  } catch {}
}

/** 「5 天前」, 「3 个月没来」, 「从没来过」. */
export function lastCame(s: AttendanceStat): string {
  if (s.daysSince === null) return t("从没来过");
  if (s.daysSince === 0) return t("今天");
  if (s.daysSince >= 90) return t("{n} 个月没来", { n: Math.round(s.daysSince / 30) });
  return t("{n} 天前", { n: s.daysSince });
}

const rateText = (s: AttendanceStat) => {
  const r = attendanceRate(s);
  return r === null ? "—" : `${r}%`;
};

/** A small inline picker: the label as text, a native select laid over it. */
function Picker<K extends string>(props: {
  label: string;
  value: K;
  options: { key: K; label: () => string }[];
  onPick: (k: K) => void;
  children: ComponentChildren;
}) {
  return (
    <span class="att-pick">
      {props.children}
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onPick((e.target as HTMLSelectElement).value as K)}
      >
        {props.options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label()}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The numbers for the member list, with the window, filter and sort the list uses. */
export function useAttendance(base: string, enabled: boolean) {
  const [win, setWin] = useState<AttendanceWindow>(savedWindow);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  // Organizers don't see the numbers: no request for them (it would only answer 403).
  const [res] = useApi<MemberAttendanceResponse>(enabled ? `${base}/members/attendance?window=${win}` : "");
  const data = enabled && res.state === "ok" ? res.data : null;
  const byId = new Map(data?.members.map((s) => [s.id, s]) ?? []);
  const level = (m: MemberSummary): ActivityLevel | null => {
    const s = byId.get(m.id);
    return s ? activityLevel(s) : null;
  };
  /** The list filtered and sorted; as it was (by member number) until the numbers arrive. */
  const arrange = (list: MemberSummary[]): MemberSummary[] => {
    if (!data) return list;
    const shown = filter === "all" ? list : list.filter((m) => level(m) === filter);
    const s = (m: MemberSummary) => byId.get(m.id);
    const cmp: Record<Sort, (a: MemberSummary, b: MemberSummary) => number> = {
      recent: (a, b) => (s(a)?.daysSince ?? 1e9) - (s(b)?.daysSince ?? 1e9),
      count: (a, b) => (s(b)?.attended ?? 0) - (s(a)?.attended ?? 0),
      rate: (a, b) =>
        (attendanceRate(s(b) ?? { attended: 0, held: 0 }) ?? -1) -
        (attendanceRate(s(a) ?? { attended: 0, held: 0 }) ?? -1),
      id: () => 0,
    };
    // Array.sort is stable: ties keep the member-number order.
    return [...shown].sort(cmp[sort]);
  };
  const counts = (list: MemberSummary[]) => {
    const n: Record<Filter, number> = { all: list.length, active: 0, quiet: 0, inactive: 0 };
    for (const m of list) {
      const l = level(m);
      if (l) n[l]++;
    }
    return n;
  };

  /** Chips and the 「近 90 天 · 共办 26 场 / 排序」 line, above the rows. */
  const controls = (list: MemberSummary[]) => {
    if (!data) return null;
    const n = counts(list);
    const winLabel = WINDOWS.find((w) => w.key === win)!.label();
    const sortLabel = SORTS.find((o) => o.key === sort)!.label();
    return (
      <div class="att-controls">
        <div class="chips att-chips" role="group" aria-label={t("按活跃程度筛选")}>
          {LEVELS.map((l) => (
            <button
              type="button"
              key={l.key}
              class={filter === l.key ? "chip on" : "chip"}
              aria-pressed={filter === l.key}
              onClick={() => setFilter(l.key)}
            >
              {l.label()}
              <i>{n[l.key]}</i>
            </button>
          ))}
        </div>
        <div class="att-meta">
          <span>
            <Picker
              label={t("统计时间")}
              value={win}
              options={WINDOWS}
              onPick={(w) => {
                setWin(w);
                saveWindow(w);
              }}
            >
              <b>{winLabel} ▾</b>
            </Picker>
            {" · "}
            {t("共办 {n} 场", { n: data.held })}
          </span>
          <Picker label={t("排序")} value={sort} options={SORTS} onPick={setSort}>
            {t("排序：{by}", { by: "" })}
            <b>{sortLabel} ▾</b>
          </Picker>
        </div>
      </div>
    );
  };

  /** What a row shows on the right: 「18 次 · 69%」 over 「5 天前」. */
  const right = (m: MemberSummary) => {
    const s = byId.get(m.id);
    if (!s) return null;
    return (
      <span class="att-right">
        <span>
          <b>{t("{n} 次", { n: s.attended })}</b> · {rateText(s)}
        </span>
        <small class={`att-${activityLevel(s)}`}>{lastCame(s)}</small>
      </span>
    );
  };
  const dot = (m: MemberSummary) => {
    const l = level(m);
    if (!l) return null;
    return (
      <>
        <span class={`att-dot att-${l}`} aria-hidden="true" />
        <span class="sr-only">{LEVELS.find((x) => x.key === l)!.label()}</span>
      </>
    );
  };

  return { data, filter, controls, arrange, right, dot };
}

/** The 「出勤」 card on a member's page. */
export function AttendanceCard(props: { base: string }) {
  const [win, setWin] = useState<AttendanceWindow>(savedWindow);
  const [res] = useApi<AttendanceDetail>(`${props.base}/attendance?window=${win}`);
  if (res.state !== "ok") return null;
  const a = res.data;
  const level = activityLevel(a);
  return (
    <section class="card att-card">
      <h2>
        {t("出勤")}
        <span class={`att-tag att-${level}`}>{LEVELS.find((x) => x.key === level)!.label()}</span>
      </h2>
      <div class="seg tiny" role="group" aria-label={t("统计时间")}>
        {WINDOWS.map((w) => (
          <button
            type="button"
            key={w.key}
            class={w.key === win ? "on" : ""}
            aria-pressed={w.key === win}
            onClick={() => {
              setWin(w.key);
              saveWindow(w.key);
            }}
          >
            {w.label()}
          </button>
        ))}
      </div>
      <div class="att-tiles">
        <div>
          <b>{t("{n} 次", { n: a.attended })}</b>
          <span>{t("参加（共办 {n} 场）", { n: a.held })}</span>
        </div>
        <div>
          <b>{rateText(a)}</b>
          <span>{t("出勤率")}</span>
        </div>
        <div>
          <b>{lastCame(a)}</b>
          <span>{t("上次来")}</span>
        </div>
        <div>
          <b>{t("{n} 次", { n: a.noShows })}</b>
          <span>{t("报了名没来")}</span>
        </div>
      </div>
      <p class="att-weeks-head">{t("近 12 周，一格一周")}</p>
      <div class="att-weeks">
        {a.weeks.map((n, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: twelve fixed weeks
          <span
            key={i}
            class={n === null ? "none" : `l${Math.min(n, 3)}`}
            title={n === null ? "" : t("{n} 次", { n })}
          />
        ))}
      </div>
      <p class="muted small">
        {t(
          "出勤率 = 来了几场 ÷ 入群以后这段时间办了几场（取消的不算）。30 天内来过算活跃，30–90 天算少来，更久没来算不活跃。",
        )}
      </p>
    </section>
  );
}
