import { useState } from "preact/hooks";
import { BOARD_KEYS, type BoardKey, type LeaderboardAdmin } from "../../shared/types";
import { api } from "../api";
import { BOARDS, BoardCard, type Period, PeriodSwitch, boardTitle, listOf, valueText } from "../Boards";
import { Load, useAction } from "../components";
import { useApi } from "../hooks";
import { t } from "../i18n";

/**
 * 管理页「排行榜」 (Ke Li 2026-11-10, option Y): every board whether public or not, one row each
 * with its top three and a 首页公开 switch; tapping a row opens the whole board under it.
 * 没登录也能看 is off by default, so names stay inside the group.
 */
export function BoardsPage(props: { base: string }) {
  const [res] = useApi<LeaderboardAdmin>(`${props.base}/leaderboard`);
  return <Load result={res}>{(d) => <Boards base={props.base} data={d} />}</Load>;
}

function Boards(props: { base: string; data: LeaderboardAdmin }) {
  const { board } = props.data;
  const [period, setPeriod] = useState<Period>("year");
  const [open, setOpen] = useState<BoardKey | null>(null);
  const [pub, setPub] = useState<BoardKey[]>(props.data.public);
  const [anon, setAnon] = useState(props.data.anon);
  const { busy, error, run } = useAction();

  async function toggle(k: BoardKey, on: boolean) {
    const was = pub;
    const next = BOARD_KEYS.filter((x) => (x === k ? on : was.includes(x)));
    setPub(next);
    if (!(await run(() => api(`${props.base}/settings`, { leaderboardBoards: next })))) setPub(was);
  }
  async function toggleAnon(on: boolean) {
    setAnon(on);
    if (!(await run(() => api(`${props.base}/settings`, { leaderboardAnon: on })))) setAnon(!on);
  }

  return (
    <>
      <div class="boards-head">
        <span class="muted small">{boardTitle(board, period)}</span>
        <PeriodSwitch period={period} set={setPeriod} />
      </div>
      <div class="board-public">{t("首页公开")}</div>
      <section class="card board-list">
        {BOARD_KEYS.map((k) => {
          const list = listOf(board, k, period);
          const shown = open === k;
          return (
            <div class="board-item" key={k}>
              <div class="board-line">
                <button
                  type="button"
                  class="board-open"
                  aria-expanded={shown}
                  onClick={() => setOpen(shown ? null : k)}
                >
                  <span class="name">{t(BOARDS[k].label)}</span>
                  <span class="top3">
                    {list.length === 0 ? (
                      t("还没有人上榜")
                    ) : (
                      <>
                        <b>{list[0]!.name}</b> {valueText(k, list[0]!.value)}
                        {list.slice(1, 3).map((r) => ` · ${r.name}`)}
                      </>
                    )}
                  </span>
                  <svg
                    class={shown ? "set-chev open" : "set-chev"}
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={t("在首页公开「{name}」", { name: t(BOARDS[k].label) })}
                  aria-checked={pub.includes(k)}
                  checked={pub.includes(k)}
                  disabled={busy}
                  onChange={(e) => toggle(k, (e.target as HTMLInputElement).checked)}
                />
              </div>
              {shown && (
                <>
                  <p class="board-desc">
                    {k === "progress" && period === "month" ? t("比上个月同期多来了几次") : t(BOARDS[k].desc)}
                  </p>
                  <BoardCard key={period} boardKey={k} list={list} />
                </>
              )}
            </div>
          );
        })}
      </section>
      <section class="card set-list bare">
        <div class="set-item">
          <label class="set-row">
            <span class="set-label grow">{t("没登录也能看")}</span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={anon}
              checked={anon}
              disabled={busy}
              onChange={(e) => toggleAnon((e.target as HTMLInputElement).checked)}
            />
          </label>
        </div>
      </section>
      <p class="muted small">
        {pub.length === 0
          ? t("首页不显示排行榜。")
          : anon
            ? t("所有人打开首页都能看到公开的排行榜，包括没登录的访客。")
            : t("只有登录的成员能在首页看到公开的排行榜。")}
      </p>
      {error && <p class="error">{error}</p>}
    </>
  );
}
