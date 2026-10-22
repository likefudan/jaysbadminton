import { useEffect, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { SHORTCUT_NAME } from "../shared/calories";
import type { CalorieStart, MyCalories, MyEvent } from "../shared/types";
import { api } from "./api";
import { Card, Load, SectionTitle, useAction } from "./components";
import { useApi } from "./hooks";
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
      {guide && (
        <CalorieGuide
          window={span}
          install={e.kcalInstall}
          update={update}
          onRead={read}
          onClose={() => setGuide(false)}
        />
      )}
    </div>
  );
}

/** The first 读取: install the Shortcut once, then come back and read. Also for updating it to a newer version. */
function CalorieGuide(props: {
  window: string;
  install: string;
  update: boolean;
  onRead: () => void;
  onClose: () => void;
}) {
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
            : t(
                "网页读不到苹果「健康」的数据，要借助一个快捷指令，只需要装一次。打球时要戴 Apple Watch，「健康」里才有活动能量。",
              )}
        </p>
        <ol class="kcal-steps">
          <li>
            <span class="n">1</span>
            <span>
              {t("安装快捷指令「{name}」", { name: SHORTCUT_NAME })}
              <small>
                {props.update
                  ? t("在 iPhone 上打开，问到同名的快捷指令时选「替换」")
                  : t("在 iPhone 上打开，点「添加快捷指令」")}
              </small>
            </span>
          </li>
          <li>
            <span class="n">2</span>
            <span>
              {t("回到这里点「开始读取」")}
              <small>{t("第一次会问能不能读取「活动能量」，选允许")}</small>
            </span>
          </li>
        </ol>
        {props.install ? (
          <a class="button block secondary" href={props.install} target="_blank" rel="noreferrer">
            {t("安装快捷指令")}
          </a>
        ) : (
          <p class="muted small">{t("安装链接还在准备中。")}</p>
        )}
        <button type="button" class="button block" onClick={props.onRead}>
          {t("已安装，开始读取")}
        </button>
        <p class="kcal-privacy">
          <FlameIcon size={16} />
          <span>
            {t("只读这场活动时间段（{time}，含开始前 10 分钟热身）的活动能量，只存一个总数，只有你自己看得到。", {
              time: props.window,
            })}
          </span>
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** 我的卡路里 on 个人信息: this year at a glance, every event read, and the 卡路里榜 choice. */
export function MyCaloriesCard(props: { base: string }) {
  const [res, reload] = useApi<MyCalories>(`${props.base}/calories`);
  return (
    <Load result={res}>
      {(c) => (c.events.length === 0 && !c.board ? null : <CaloriesCard c={c} base={props.base} onChange={reload} />)}
    </Load>
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
    if (await run(() => api(`${props.base}/calories/delete`, e ? { code: e.code } : { all: true }))) props.onChange();
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
                  <tr key={e.code}>
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
