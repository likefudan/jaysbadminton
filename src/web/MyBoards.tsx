import { useEffect, useState } from "preact/hooks";
import { BOARD_KEYS, type BoardKey, type MyBoards } from "../shared/types";
import { api } from "./api";
import { BOARDS } from "./Boards";
import { SettingRow, useAction } from "./components";
import { useApi } from "./hooks";
import { t, tk } from "./i18n";

/** What the others see of them on each board, under its switch. */
const SHOWS: Record<BoardKey, string> = {
  calories: tk("显示你的名字和千卡数"),
  attendance: tk("显示你的名字和来打球的次数"),
  hours: tk("显示你的名字和在场小时数"),
  progress: tk("显示你的名字和多来了几次"),
  streak: tk("显示你的名字和最长连续场数"),
  friends: tk("显示你的名字和带朋友的人次"),
  queue: tk("显示你的名字和帮大家排队的次数"),
  early: tk("显示你的名字和早报名的次数"),
  likes: tk("显示你的名字和收到的赞数"),
};

/**
 * 个人信息 › 设置 › 排行榜 (Ke Li 2026-11-21, option A): one switch per board. 能量 is the same
 * switch as 我的卡路里's 加入能量榜; the others are on until they turn them off.
 */
export function BoardsRow(props: { base: string; startOpen?: boolean; onChange?: () => void }) {
  const [mine, reload] = useApi<MyBoards>(`${props.base}/boards`);
  const on = mine.state === "ok" ? BOARD_KEYS.filter((k) => mine.data[k]).length : null;
  return (
    <SettingRow
      icon={<TrophyIcon />}
      label={t("排行榜")}
      sub={on === null ? undefined : on === 0 ? t("没有参加排行榜") : t("参加 {n} 个榜", { n: on })}
      startOpen={props.startOpen}
      panel={() =>
        mine.state === "ok" ? (
          <BoardSwitches
            base={props.base}
            mine={mine.data}
            onChange={() => {
              reload();
              props.onChange?.();
            }}
          />
        ) : null
      }
    />
  );
}

function BoardSwitches(props: { base: string; mine: MyBoards; onChange: () => void }) {
  const [mine, setMine] = useState(props.mine);
  useEffect(() => setMine(props.mine), [props.mine]);
  const { busy, error, run } = useAction();
  async function toggle(board: BoardKey, on: boolean) {
    setMine({ ...mine, [board]: on });
    const saved = await run(() => api<MyBoards>(`${props.base}/boards`, { board, on }));
    if (saved) {
      setMine(saved);
      props.onChange();
    } else setMine({ ...mine, [board]: !on });
  }
  return (
    <div class="board-opts">
      <p class="board-opts-note">
        {t("关掉的榜上不会出现你的名字和头像，后面的人名次往前顺延。你自己的数据和年度回顾不受影响。")}
      </p>
      {BOARD_KEYS.map((k) => (
        <label class="board-opt" key={k}>
          <span>
            <strong>{t(BOARDS[k].label)}</strong>
            <small>{t(SHOWS[k])}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={mine[k]}
            checked={mine[k]}
            disabled={busy}
            onChange={(e) => toggle(k, (e.target as HTMLInputElement).checked)}
          />
        </label>
      ))}
      {error && <p class="error">{error}</p>}
    </div>
  );
}

const TrophyIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
  </svg>
);
