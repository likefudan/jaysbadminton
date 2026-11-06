import {
  arriveChoices,
  eventLength,
  headcountSlots,
  leaveChoices,
  offsetOf,
  STAY_STEP_MIN,
  timeAt,
} from "../shared/stay";
import { t } from "./i18n";

/** 在场时间 (Ke Li 2026-11-06): optional 到 and 走 on a sign-up, and the 各时段人数 chart. */

type Stay = { arrive: string | null; leave: string | null };

/** "8:00" rather than "08:00", as people write it. */
export const clock = (s: string) => s.replace(/^0(\d)/, "$1");

/** "10:15–14:00", or "13:30 到" with only an arrival; "" when not given. */
export function stayText(s: Stay): string {
  if (!s.arrive) return "";
  return s.leave ? `${clock(s.arrive)}–${clock(s.leave)}` : t("{time} 到", { time: clock(s.arrive) });
}

/**
 * The two dropdowns on the sign-up form as one time range, no labels (Ke Li): 「几点到 – 几点走」,
 * both optional; 走 only once 到 is picked.
 */
export function StayPicker(props: { start: string; end: string; value: Stay; onChange: (s: Stay) => void }) {
  const { start, end, value } = props;
  const arrives = arriveChoices(start, end);
  const leaves = value.arrive ? leaveChoices(start, end, value.arrive) : [];
  return (
    <div class="stay-picker">
      <div class="stay-range">
        <label class="field">
          <select
            aria-label={t("到")}
            value={value.arrive ?? ""}
            onChange={(e) => {
              const arrive = (e.target as HTMLSelectElement).value || null;
              // A 走 that no longer comes after the new 到 is dropped.
              const keep = arrive && value.leave && leaveChoices(start, end, arrive).includes(value.leave);
              props.onChange({ arrive, leave: keep ? value.leave : null });
            }}
          >
            <option value="">{t("几点到")}</option>
            {arrives.map((a) => (
              <option key={a} value={a}>
                {clock(a)}
              </option>
            ))}
          </select>
        </label>
        <span class="stay-dash">–</span>
        <label class="field">
          <select
            aria-label={t("走")}
            disabled={!value.arrive}
            value={value.leave ?? ""}
            onChange={(e) => props.onChange({ ...value, leave: (e.target as HTMLSelectElement).value || null })}
          >
            <option value="">{t("几点走")}</option>
            {leaves.map((l) => (
              <option key={l} value={l}>
                {clock(l)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/**
 * 各时段人数: one bar per 15 minutes over the event's time, the viewer's own time darker; no
 * caption (Ke Li). Shown only once someone has given a time.
 */
export function StayChart(props: { start: string; end: string; stays: Stay[]; mine: Stay | null }) {
  const { start, end } = props;
  const slots = headcountSlots(start, end, props.stays);
  const max = Math.max(0, ...slots);
  if (max === 0) return null;
  const len = eventLength(start, end);
  const mine = props.mine?.arrive ? props.mine : null;
  const myFrom = mine ? offsetOf(start, mine.arrive!) : -1;
  const myTo = mine ? (mine.leave ? offsetOf(start, mine.leave) || len : len) : -1;
  // Hour marks: every 2 hours on a long event, every hour on a short one.
  const every = len > 6 * 60 ? 120 : 60;
  const at = offsetOf("00:00", start);
  const marks: number[] = [];
  for (let m = (60 - (at % 60)) % 60; m <= len; m += 60) if ((at + m) % every === 0) marks.push(m);
  return (
    <div class="stay-chart">
      <div class="stay-bars" role="img" aria-label={t("各时段人数")}>
        {slots.map((n, i) => {
          const t0 = i * STAY_STEP_MIN;
          return (
            <i
              key={i}
              class={t0 >= myFrom && t0 < myTo ? "me" : undefined}
              style={{ height: `${n ? (n / max) * 100 : 3}%` }}
              title={`${clock(timeAt(start, t0))} · ${n}`}
            />
          );
        })}
      </div>
      <div class="stay-axis">
        {marks.map((m) => (
          <span
            key={m}
            style={{
              left: `${(m / len) * 100}%`,
              transform: m >= len ? "translateX(-100%)" : m === 0 ? "none" : undefined,
            }}
          >
            {Number(timeAt(start, m).slice(0, 2))}
          </span>
        ))}
      </div>
    </div>
  );
}
