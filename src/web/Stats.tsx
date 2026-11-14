import { useState } from "preact/hooks";
import { api } from "./api";
import { dollars } from "../shared/settle";
import { RANGES, bucketTitle, niceScale, parseDollars, summarize, type RangeId } from "../shared/spending";
import type { MyStats, SpendEntry } from "../shared/types";
import { Card } from "./components";
import { dateText, fmtDate, t, tk } from "./i18n";

/** 我的数据 → 我的花费, before it opens: this year's total, visits and average. */
export const thisYear = (s: MyStats) => summarize(s.history, "YTD", s.today);

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
 * week, month or year. Tapping a column shows its numbers; 明细 lists the events behind them, and
 * each can carry 自付费用 (Ke Li 2026-11-14, option B): money they paid themselves, such as the
 * drop-in fee at the door. Only they see it; it adds to the totals and tops the columns.
 */
export function SpendingCard(props: { stats: MyStats; base?: string; onChanged?: () => void }) {
  const [range, setRange] = useState<RangeId>(savedRange);
  const [picked, setPicked] = useState<number | null>(null);
  const sum = summarize(props.stats.history, range, props.stats.today);
  const { top, step } = niceScale(Math.max(...sum.buckets.map((b) => b.cents)));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).reverse();
  const labelEvery = Math.ceil(sum.buckets.length / 7);
  const shown = picked !== null ? sum.buckets[picked] : undefined;
  const [editing, setEditing] = useState<number | null>(null);

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
      {sum.extraCents > 0 && (
        <p class="spend-split">
          <span>
            <i class="spend-key" />
            {t("群里收 {amount}", { amount: `$${dollars(sum.cents - sum.extraCents)}` })}
          </span>
          <span>
            <i class="spend-key extra" />
            {t("自付 {amount}", { amount: `$${dollars(sum.extraCents)}` })}
          </span>
        </p>
      )}
      <p class="spend-readout" aria-live="polite">
        {shown && (
          <>
            <strong>{dateText(bucketTitle(shown, sum.unit))}</strong> ·{" "}
            {t("花费 {amount} · 打球 {n} 次", { amount: `$${dollars(shown.cents)}`, n: shown.count })}
            {shown.extraCents > 0 && ` · ${t("自付 {amount}", { amount: `$${dollars(shown.extraCents)}` })}`}
          </>
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
                {b.cents > 0 && (
                  <span class="spend-bar" style={{ height: `${(b.cents / top) * 100}%` }}>
                    {b.extraCents > 0 && (
                      <span class="spend-bar-extra" style={{ height: `${(b.extraCents / b.cents) * 100}%` }} />
                    )}
                  </span>
                )}
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
              {[...sum.entries].reverse().map((e) => (
                <SpendRow
                  key={e.id}
                  entry={e}
                  showYear={e.date.slice(0, 4) !== props.stats.today.slice(0, 4)}
                  base={props.base}
                  editing={editing === e.id}
                  onEdit={(on) => setEditing(on ? e.id : null)}
                  onSaved={() => {
                    setEditing(null);
                    props.onChanged?.();
                  }}
                />
              ))}
            </tbody>
          </table>
        </details>
      ) : (
        <p class="muted small">{t("{range}没有打球记录。", { range: t(RANGE_NAMES[range]) })}</p>
      )}
    </Card>
  );
}

/** One event in 明细, with its 自付 button; tapping it opens a line to type the amount under it. */
function SpendRow(props: {
  entry: SpendEntry;
  showYear: boolean;
  base?: string;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onSaved: () => void;
}) {
  const e = props.entry;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function open() {
    setText(e.extraCents ? dollars(e.extraCents) : "");
    setError("");
    props.onEdit(!props.editing);
  }
  async function save(cents: number) {
    setBusy(true);
    setError("");
    try {
      await api(`${props.base}/stats/extra`, { eventId: e.id, cents });
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(ev: Event) {
    ev.preventDefault();
    const cents = parseDollars(text);
    if (cents === null) setError(t("请输入金额，比如 15"));
    else void save(cents);
  }

  return (
    <>
      <tr>
        <td>{fmtDate(e.date, props.showYear)}</td>
        <td class="muted">
          {e.title || e.location}
          {!e.attended && <span class="spend-absent"> · {t("缺席")}</span>}
        </td>
        <td class="num">{e.cents > 0 || !e.extraCents ? `$${dollars(e.cents)}` : "—"}</td>
        {props.base && (
          <td class="spend-extra-cell">
            <button
              type="button"
              class={`spend-extra-btn${e.extraCents ? " set" : ""}`}
              aria-expanded={props.editing}
              onClick={open}
            >
              {e.extraCents ? t("自付 {amount}", { amount: `$${dollars(e.extraCents)}` }) : t("＋自付")}
            </button>
          </td>
        )}
      </tr>
      {props.editing && (
        <tr class="spend-extra-edit">
          <td colSpan={4}>
            <form onSubmit={submit}>
              <label class="spend-extra-input">
                <span>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="15"
                  aria-label={t("自付费用")}
                  value={text}
                  onInput={(ev) => setText((ev.target as HTMLInputElement).value)}
                />
              </label>
              <button type="submit" class="button" disabled={busy}>
                {t("保存")}
              </button>
              {e.extraCents > 0 && (
                <button type="button" class="link-button" disabled={busy} onClick={() => void save(0)}>
                  {t("清除")}
                </button>
              )}
              <button type="button" class="link-button" disabled={busy} onClick={() => props.onEdit(false)}>
                {t("取消")}
              </button>
            </form>
            <p class={error ? "spend-extra-hint error" : "spend-extra-hint"}>
              {error || t("自己另外付的钱，比如进门交的场地费。只有你看得到。")}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
