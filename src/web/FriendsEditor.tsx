import { Panel } from "./Panel";
import { useEffect, useState } from "preact/hooks";
import type { GuestChoice } from "../shared/types";
import { Field } from "./components";
import { t } from "./i18n";

/** One friend they bring: a name (may be blank), or a group member picked with 选群友 (带群友). */
export interface FriendSlot {
  name: string;
  guest?: { id: string; name: string };
}

/** The slots for a saved sign-up: the group members first, then the friends known by name. */
export const toSlots = (friends: string[], guests: { id: string; name: string }[] = []): FriendSlot[] => [
  ...guests.map((g) => ({ name: "", guest: g })),
  ...friends.map((name) => ({ name })),
];

/** What the sign-up endpoints take: names for friends, member ids for 带群友. */
export const fromSlots = (slots: FriendSlot[]) => ({
  friends: slots.filter((s) => !s.guest).map((s) => s.name),
  guests: slots.flatMap((s) => (s.guest ? [s.guest.id] : [])),
});

/**
 * A +/- counter for friends with an optional name for each. With `choices`, each one can instead
 * be a group member, picked from a list (选群友, Ke Li's option A): they pay nothing themselves.
 */
export function FriendsEditor(props: {
  friends: FriendSlot[];
  max: number | null;
  onChange: (f: FriendSlot[]) => void;
  label?: string;
  /** The members who could be brought; leaving it out hides 选群友. */
  choices?: () => Promise<GuestChoice[]>;
}) {
  const f = props.friends;
  const [picking, setPicking] = useState<number | null>(null);
  const set = (i: number, v: FriendSlot) => props.onChange(f.map((x, j) => (j === i ? v : x)));
  return (
    <div class="friends-editor">
      <div class="friends-row">
        <div class="friends-label">
          <span>{props.label ?? t("带朋友")}</span>
          {props.max !== null && <small class="muted">{t("最多 {n} 个朋友", { n: props.max })}</small>}
        </div>
        <div class="stepper">
          <button
            type="button"
            disabled={f.length === 0}
            onClick={() => props.onChange(f.slice(0, -1))}
            aria-label={t("少一个")}
          >
            −
          </button>
          <output>{f.length}</output>
          <button
            type="button"
            disabled={props.max !== null && f.length >= props.max}
            onClick={() => props.onChange([...f, { name: "" }])}
            aria-label={t("多一个")}
          >
            +
          </button>
        </div>
      </div>
      {f.map((slot, i) =>
        slot.guest ? (
          <div key={i} class="field">
            <span>{t("朋友 {n}", { n: i + 1 })}</span>
            <div class="guest-picked">
              <i class="guest-avatar" aria-hidden="true">
                {slot.guest.name.slice(0, 1)}
              </i>
              <b class="guest-name">{slot.guest.name}</b>
              <em class="guest-tag">{t("群友")}</em>
              <button
                type="button"
                class="guest-clear"
                aria-label={t("改回填名字")}
                onClick={() => set(i, { name: "" })}
              >
                ✕
              </button>
            </div>
          </div>
        ) : props.choices ? (
          <label key={i} class="field">
            <span>{t("朋友 {n}", { n: i + 1 })}</span>
            <div class="guest-input">
              <input
                type="text"
                placeholder={t("名字（选填）")}
                value={slot.name}
                onInput={(e) => set(i, { name: (e.target as HTMLInputElement).value })}
              />
              <button type="button" class="guest-pick" onClick={() => setPicking(i)}>
                {t("选群友")} ▾
              </button>
            </div>
          </label>
        ) : (
          <Field
            key={i}
            label={t("朋友 {n} 的名字（选填）", { n: i + 1 })}
            value={slot.name}
            onInput={(v) => set(i, { name: v })}
          />
        ),
      )}
      {picking !== null && props.choices && (
        <GuestPicker
          load={props.choices}
          taken={f.flatMap((s, j) => (s.guest && j !== picking ? [s.guest.id] : []))}
          onPick={(g) => {
            set(picking, { name: "", guest: g });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/**
 * 选群友: a sheet listing the group by name, with a search box. Those on the event already, or
 * brought by someone else, are dimmed and say so; so are those picked for another slot.
 */
function GuestPicker(props: {
  load: () => Promise<GuestChoice[]>;
  taken: string[];
  onPick: (g: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<GuestChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    props.load().then(setList, () => setFailed(true));
  }, []);
  const why = (c: GuestChoice) =>
    props.taken.includes(c.id)
      ? t("已选")
      : c.state === "on"
        ? t("已报名")
        : c.state === "brought"
          ? t("{name} 已带", { name: c.by ?? "" })
          : null;
  const shown = (list ?? []).filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Panel title={t("选群友")} label={t("选群友")} onClose={props.onClose} class="guest-sheet">
      <input
        class="cq-search"
        type="search"
        placeholder={t("搜索")}
        aria-label={t("搜索")}
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      {failed && <p class="error">{t("加载失败，请稍后再试")}</p>}
      {!list && !failed && <p class="muted">{t("加载中…")}</p>}
      <ul class="guest-list">
        {shown.map((c) => {
          const no = why(c);
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={!!no}
                onClick={() => props.onPick({ id: c.id, name: c.name })}
                class={no ? "off" : ""}
              >
                <i class="guest-avatar" aria-hidden="true">
                  {c.name.slice(0, 1)}
                </i>
                <b class="guest-name">{c.name}</b>
                {no && <small>{no}</small>}
              </button>
            </li>
          );
        })}
        {list && shown.length === 0 && <li class="muted guest-none">{t("没有找到")}</li>}
      </ul>
    </Panel>
  );
}
