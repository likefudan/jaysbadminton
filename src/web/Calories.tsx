import { useEffect, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { SHORTCUT_NAME } from "../shared/calories";
import type { CalorieStart, MyCalories, MyEvent } from "../shared/types";
import { api } from "./api";
import { Card, Load, SectionTitle, SettingRow, useAction } from "./components";
import type { Loaded } from "./hooks";
import { isIos } from "./Install";
import { fmtDate, t, tx } from "./i18n";

const INSTALLED_KEY = "kcal-shortcut-installed";

function installed(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

export const kcalText = (n: number) => n.toLocaleString("en-US");

export const FlameIcon = (props: { size?: number }) => (
  <svg class="flame" viewBox="0 0 24 24" width={props.size ?? 18} height={props.size ?? 18} aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 2c.6 3.2-1 5.1-2.6 6.9C7.9 10.6 6.5 12.2 6.5 15A5.5 5.5 0 0 0 12 20.5 5.5 5.5 0 0 0 17.5 15c0-2.3-1-4-2.2-5.4-.2 1.4-.9 2.5-2 3 .5-3.6-.4-7.6-1.3-10.6z"
    />
  </svg>
);

/**
 * 卡路里 on an event card: the number once read, and 读取 on iPhone from the start of the event for
 * as many days as 设置 says (30 at first). Web pages can't read 「健康」, so 读取 runs a Shortcut with the event's times and a
 * one-time upload link; the card reloads when they come back to the page.
 */
export function CalorieRow(props: { base: string; e: MyEvent; onChange: () => void }) {
  const e = props.e;
  const [guide, setGuide] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const { busy, error, run } = useAction();
  const ios = isIos();
  useEffect(() => {
    if (!waiting) return;
    const back = () => {
      if (document.visibilityState !== "visible") return;
      setWaiting(false);
      props.onChange();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [waiting]);

  const canRead = e.kcalOpen && ios;
  const update = canRead && (e.kcalUpdate ?? false);
  const kcal = e.kcal ?? null;
  if (kcal === null && !canRead) return null;

  async function read() {
    setGuide(false);
    const s = await run(() => api<CalorieStart>(`${props.base}/events/${e.id}/calories`, {}));
    if (!s) return;
    try {
      localStorage.setItem(INSTALLED_KEY, "1");
    } catch {
      /* private mode: the guide just shows again next time */
    }
    setWaiting(true);
    const input = JSON.stringify({ start: s.start, end: s.end, upload: s.upload });
    location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(input)}`;
  }

  const span = `${e.startTime}–${e.endTime}`;
  return (
    <div class="kcal-foot">
      <div class="kcal-row">
        <FlameIcon />
        {kcal === null ? (
          <span class="kcal-text">
            {t("这场打球消耗了多少？")}
            <small>{t("从 iPhone「健康」读取")}</small>
          </span>
        ) : (
          <span class="kcal-text">
            {tx("{n} 千卡", { n: <b class="kcal-num">{kcalText(kcal)}</b> })}
            <small>{t("{time} · 来自 Apple 健康", { time: span })}</small>
          </span>
        )}
        {canRead &&
          (kcal === null ? (
            <button
              type="button"
              class="button secondary"
              disabled={busy}
              onClick={() => (installed() && !update ? read() : setGuide(true))}
            >
              {t("读取")}
            </button>
          ) : (
            <button
              type="button"
              class="link-button"
              disabled={busy}
              onClick={() => (update ? setGuide(true) : read())}
            >
              {t("重新读取")}
            </button>
          ))}
      </div>
      {update && (
        <button type="button" class="link-button kcal-update" onClick={() => setGuide(true)}>
          {t("快捷指令有新版本，点这里更新")}
        </button>
      )}
      {error && <p class="error">{error}</p>}
      {guide && <CalorieGuide install={e.kcalInstall} update={update} onRead={read} onClose={() => setGuide(false)} />}
    </div>
  );
}

/**
 * The first 读取: install the Shortcut once, then come back and read. Also for updating it to a newer
 * version, and (without onRead) for 个人信息 → 卡路里快捷指令, to install it again any time.
 */
function CalorieGuide(props: { install: string; update: boolean; onRead?: () => void; onClose: () => void }) {
  const read = props.onRead;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside is a mouse shortcut; Esc and ✕ close it too
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-label={t("读取卡路里")}>
        <div class="sheet-head">
          <strong>{t("读取卡路里")}</strong>
          <button type="button" class="sheet-close" aria-label={t("关闭")} onClick={props.onClose}>
            ✕
          </button>
        </div>
        <p class="kcal-intro">
          {props.update
            ? t("快捷指令有新版本，读得更快。请重新安装一次，替换掉旧的。")
            : t("要戴 Apple Watch 打球，装一次快捷指令就行。")}
        </p>
        <ol class="kcal-steps">
          <li>
            <span class="n">1</span>
            <span>
              {t("安装快捷指令「{name}」", { name: SHORTCUT_NAME })}
              <small>
                {props.update
                  ? t("在 iPhone 上打开，问到同名的快捷指令时选「替换」")
                  : read
                    ? t("在 iPhone 上打开，点「添加快捷指令」")
                    : t("在 iPhone 上打开，点「添加快捷指令」；问到同名的就选「替换」")}
              </small>
            </span>
          </li>
          <li>
            <span class="n">2</span>
            {read ? (
              <span>
                {t("回到这里点「开始读取」")}
                <small>{t("第一次会问能不能读取「活动能量」，选允许")}</small>
              </span>
            ) : (
              <span>
                {t("打完球后，在活动卡片上点「读取」")}
                <small>{t("第一次会问能不能读取「活动能量」，选允许")}</small>
              </span>
            )}
          </li>
        </ol>
        {props.install ? (
          <a
            class={read ? "button block secondary" : "button block"}
            href={props.install}
            target="_blank"
            rel="noreferrer"
          >
            {t("安装快捷指令")}
          </a>
        ) : (
          <p class="muted small">{t("安装链接还在准备中。")}</p>
        )}
        {read && (
          <button type="button" class="button block" onClick={read}>
            {t("已安装，开始读取")}
          </button>
        )}
        <p class="kcal-privacy">
          <FlameIcon size={16} />
          <span>{t("只存总数，只有你看得到。")}</span>
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** 我的卡路里 on 个人信息: this year at a glance, every event read, and the 卡路里榜 choice. */
export function MyCaloriesCard(props: { base: string; result: Loaded<MyCalories>; reload: () => void }) {
  return (
    <Load result={props.result}>
      {(c) =>
        c.events.length === 0 && !c.board ? null : <CaloriesCard c={c} base={props.base} onChange={props.reload} />
      }
    </Load>
  );
}

/** The flame drawn in lines, like the other icons in the settings list. */
const FlameOutline = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d="M12 3c.6 3.2-1.2 5-2.8 6.8C7.8 11.3 6.5 13 6.5 15.5a5.5 5.5 0 0 0 11 0c0-2.5-1.2-4.4-2.6-5.9-.3 1.5-1 2.5-2.1 3 .6-3.6-.2-7-.8-9.6z" />
  </svg>
);

/**
 * 个人信息 → 卡路里快捷指令, there for good on iPhone and iPad: whoever deleted the Shortcut (or never
 * got to 读取 yet) can install it again without waiting for an event card to offer it.
 */
export function ShortcutRow(props: { shortcut: MyCalories["shortcut"] | null }) {
  const [open, setOpen] = useState(false);
  const s = props.shortcut;
  if (!s?.url || !isIos()) return null;
  return (
    <>
      <SettingRow
        icon={<FlameOutline />}
        label={t("卡路里快捷指令")}
        value={s.outdated ? <span class="set-new">{t("有新版本")}</span> : undefined}
        onClick={() => setOpen(true)}
      />
      {open && <CalorieGuide install={s.url} update={s.outdated} onClose={() => setOpen(false)} />}
    </>
  );
}

function CaloriesCard(props: { c: MyCalories; base: string; onChange: () => void }) {
  const c = props.c;
  const [board, setBoard] = useState(c.board);
  const { busy, error, run } = useAction();
  async function toggle(on: boolean) {
    setBoard(on);
    if (!(await run(() => api(`${props.base}/calories/board`, { on })))) setBoard(!on);
    else props.onChange();
  }
  async function remove(e?: MyCalories["events"][number]) {
    const ask = e
      ? t("删除 {date} 这场的卡路里记录（{n} 千卡）？", { date: fmtDate(e.date, true), n: kcalText(e.kcal) })
      : t("删除你全部 {n} 场的卡路里记录？删除后不能恢复，排行榜上也不会再有。", { n: c.events.length });
    if (!confirm(ask)) return;
    if (await run(() => api(`${props.base}/calories/delete`, e ? { id: e.id } : { all: true }))) props.onChange();
  }
  const year = String(c.year);
  return (
    <>
      <SectionTitle>{t("我的卡路里")}</SectionTitle>
      <Card class="kcal-card">
        <div class="spend-figures">
          <div>
            <span class="tile-label">{t("{year} 年", { year: c.year })}</span>
            <span class="tile-value">
              {kcalText(c.yearKcal)}
              <small>{t("千卡")}</small>
            </span>
          </div>
          <div>
            <span class="tile-label">{t("记录")}</span>
            <span class="tile-value">
              {c.yearCount}
              <small>{t("场")}</small>
            </span>
          </div>
          <div>
            <span class="tile-label">{t("平均每场")}</span>
            <span class="tile-value">
              {c.yearCount ? kcalText(Math.round(c.yearKcal / c.yearCount)) : "—"}
              {c.yearCount > 0 && <small>{t("千卡")}</small>}
            </span>
          </div>
        </div>
        {c.events.length > 0 && (
          <details class="fold spend-detail">
            <summary>{t("明细（{n} 场）", { n: c.events.length })}</summary>
            <table>
              <tbody>
                {c.events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <a href={`/e/${e.code}`}>{fmtDate(e.date, !e.date.startsWith(year))}</a>
                    </td>
                    <td class="muted">{e.title || e.location}</td>
                    <td class="num">{t("{n} 千卡", { n: kcalText(e.kcal) })}</td>
                    <td class="kcal-del">
                      <button
                        type="button"
                        class="link-button"
                        aria-label={t("删除这场的卡路里记录")}
                        disabled={busy}
                        onClick={() => remove(e)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        <label class="switch-card plain">
          <span>
            <strong>{t("加入能量榜")}</strong>
            <small>{t("首页排行榜会显示你的名字和今年的总千卡，所有人都看得到。随时可以退出。")}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={board}
            checked={board}
            disabled={busy}
            onChange={(e) => toggle((e.target as HTMLInputElement).checked)}
          />
        </label>
        {c.events.length > 0 && (
          <button type="button" class="link-button danger kcal-del-all" disabled={busy} onClick={() => remove()}>
            {t("删除我的全部卡路里记录")}
          </button>
        )}
        {error && <p class="error">{error}</p>}
      </Card>
    </>
  );
}
