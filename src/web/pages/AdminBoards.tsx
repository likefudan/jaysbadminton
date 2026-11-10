import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardKey, LeaderboardAdmin } from "../../shared/types";
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
  const [order, setOrder] = useState(board.boards);
  const [dragging, setDragging] = useState<BoardKey | null>(null);
  const drag = useRef<{
    key: BoardKey;
    before: BoardKey[];
    next: BoardKey[];
    pointerId: number;
    y: number;
    list: HTMLElement;
  } | null>(null);
  const scrollFrame = useRef(0);
  const { busy, error, run } = useAction();
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

  async function saveOrder(next: BoardKey[], before: BoardKey[]) {
    if (next.every((k, i) => k === before[i])) return;
    if (!(await run(() => api(`${props.base}/settings`, { leaderboardOrder: next })))) setOrder(before);
  }
  function startDrag(e: PointerEvent, key: BoardKey) {
    if (busy || drag.current || !e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    const list = (e.currentTarget as HTMLElement).closest<HTMLElement>(".board-list")!;
    list.setPointerCapture(e.pointerId);
    drag.current = { key, before: order, next: order, pointerId: e.pointerId, y: e.clientY, list };
    setOpen(null);
    setDragging(key);
    // Keep scrolling while the pointer is held at an edge, even when it stops moving.
    const scroll = () => {
      const d = drag.current;
      if (!d) return;
      const delta = d.y < 70 ? -10 : d.y > window.innerHeight - 70 ? 10 : 0;
      if (delta) {
        window.scrollBy({ top: delta, behavior: "instant" });
        moveAt(d);
      }
      scrollFrame.current = requestAnimationFrame(scroll);
    };
    scrollFrame.current = requestAnimationFrame(scroll);
  }
  function moveAt(d: NonNullable<typeof drag.current>) {
    const rows = d.list.querySelectorAll<HTMLElement>(".board-item");
    const from = d.next.indexOf(d.key);
    let to = from;
    rows.forEach((row, i) => {
      const rect = row.getBoundingClientRect();
      const middle = rect.top + rect.height / 2;
      if ((i < from && d.y < middle && to === from) || (i > from && d.y > middle)) to = i;
    });
    if (to !== from) {
      const next = [...d.next];
      next.splice(from, 1);
      next.splice(to, 0, d.key);
      d.next = next;
      setOrder(next);
    }
  }
  function moveDrag(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.y = e.clientY;
    moveAt(d);
  }
  function endDrag(e: PointerEvent, cancel = false) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(scrollFrame.current);
    setDragging(null);
    if (cancel) setOrder(d.before);
    else void saveOrder(d.next, d.before);
    const list = e.currentTarget as HTMLElement;
    if (list.hasPointerCapture(e.pointerId)) list.releasePointerCapture(e.pointerId);
  }
  function moveWithKeyboard(e: KeyboardEvent, key: BoardKey) {
    if (busy || dragging || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const from = order.indexOf(key);
    const to = from + (e.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, key);
    setOrder(next);
    // Moving a keyed DOM node can drop focus. Keep keyboard users on the same handle.
    const list = (e.currentTarget as HTMLElement).closest(".board-list")!;
    requestAnimationFrame(() => list.querySelector<HTMLButtonElement>(`[data-board="${key}"] .board-handle`)?.focus());
    void saveOrder(next, order).then(() => {
      // A failed save moves the row back, which can also remove focus from its handle.
      if (document.activeElement === document.body)
        requestAnimationFrame(() =>
          list.querySelector<HTMLButtonElement>(`[data-board="${key}"] .board-handle`)?.focus(),
        );
    });
  }

  async function toggle(k: BoardKey, on: boolean) {
    const was = pub;
    const next = order.filter((x) => (x === k ? on : was.includes(x)));
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
      <section
        class="card board-list"
        onPointerMove={moveDrag}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={(e) => endDrag(e, true)}
        onLostPointerCapture={(e) => endDrag(e, true)}
      >
        {order.map((k) => {
          const list = listOf(board, k, period);
          const shown = open === k;
          return (
            <div class={`board-item${dragging === k ? " sorting" : ""}`} key={k} data-board={k}>
              <div class="board-line">
                <button
                  type="button"
                  class="board-handle"
                  aria-label={t("拖动调整「{name}」的顺序，或用上下方向键", { name: t(BOARDS[k].label) })}
                  aria-disabled={busy || (dragging !== null && dragging !== k)}
                  onPointerDown={(e) => startDrag(e, k)}
                  onKeyDown={(e) => moveWithKeyboard(e, k)}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path d="M8 6h1m6 0h1M8 12h1m6 0h1M8 18h1m6 0h1" />
                  </svg>
                </button>
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
                  disabled={busy || dragging !== null}
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
              disabled={busy || dragging !== null}
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
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
