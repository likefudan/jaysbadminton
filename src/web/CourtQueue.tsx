import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  courtPhase,
  QUEUE_COURT_MAX,
  QUEUE_GROUP_MAX,
  QUEUE_MAX_POSITION,
  QUEUE_SOON_MIN,
  type QueueCourt,
  type QueueInfo,
  queueWait,
} from "../shared/courtQueue";
import { toPacific } from "../shared/time";
import type { MyEvent } from "../shared/types";
import { api } from "./api";
import { Field, useAction } from "./components";
import { t } from "./i18n";

/** Over this many accounts, the lists get a search box. */
const SEARCH_FROM = 8;
/** How often the card fetches what others entered, while it is on screen. */
const REFRESH_MS = 60_000;

/** Re-renders every 20 seconds, so countdowns move without a reload. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

type Sheet = { kind: "court"; court: QueueCourt | null } | { kind: "accounts" } | null;

/**
 * 球场: the courts we hold and queue for, each drawn as a court with our hall usernames on its two
 * halves (Ke Li's design: four to a row, names stacked). The two buttons stay at the top of the
 * screen and the colour key at the bottom while the courts are on screen.
 */
export function CourtQueue(props: { base: string; e: MyEvent; onChange: () => void }) {
  const q = props.e.queue!;
  const now = useNow();
  const [sheet, setSheet] = useState<Sheet>(null);

  // The buttons stick just under the top bar, whose height depends on the phone (notch, font size).
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(".topbar");
    if (!bar) return;
    const set = () => document.documentElement.style.setProperty("--topbar-h", `${bar.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // What others entered shows up without anyone pulling to refresh.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && props.onChange(), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const shown = q.courts.flatMap((c) => {
    const p = courtPhase(c, now);
    return p.phase === "done" ? [] : [{ c, p }];
  });
  const playing = shown.filter((x) => x.p.phase === "playing").sort((a, b) => a.c.court - b.c.court);
  const queued = shown
    .filter((x) => x.p.phase === "queued")
    .sort((a, b) => a.p.minutes - b.p.minutes || a.c.court - b.c.court);
  const last = q.courts.reduce<QueueCourt | null>((a, c) => (!a || c.updatedAt > a.updatedAt ? c : a), null);
  const close = () => setSheet(null);
  const done = () => {
    setSheet(null);
    props.onChange();
  };

  return (
    <div class="cq">
      <div class="cq-head">
        <strong>{t("球场")}</strong>
        {last && (
          <span class="muted small">
            {t("{name} 更新于 {time}", { name: last.updatedBy, time: toPacific(last.updatedAt).time })}
          </span>
        )}
      </div>
      <div class="cq-bar">
        <button type="button" class="button" onClick={() => setSheet({ kind: "court", court: null })}>
          {t("＋ 登记球场")}
        </button>
        <button type="button" class="button secondary" onClick={() => setSheet({ kind: "accounts" })}>
          {t("球馆账号（{n}）", { n: q.accounts.length })}
        </button>
      </div>
      {shown.length === 0 && (
        <p class="muted small">{t("还没有登记球场。在球馆电脑上排好后，点「登记球场」填进来。")}</p>
      )}
      {playing.length > 0 && (
        <>
          <p class="cq-sub">{t("在打 · {n} 片", { n: playing.length })}</p>
          <div class="cq-grid">
            {playing.map(({ c, p }) => (
              <CourtTile
                key={c.id}
                c={c}
                tone={p.minutes <= QUEUE_SOON_MIN ? "soon" : "play"}
                line={t("剩 {n} 分", { n: p.minutes })}
                onOpen={() => setSheet({ kind: "court", court: c })}
              />
            ))}
          </div>
        </>
      )}
      {queued.length > 0 && (
        <>
          <p class="cq-sub">{t("排队 · {n} 组", { n: queued.length })}</p>
          <div class="cq-grid">
            {queued.map(({ c, p }) => (
              <CourtTile
                key={c.id}
                c={c}
                tone="queue"
                line={t("第{k}组 ≈{n}分", { k: c.position, n: p.minutes })}
                onOpen={() => setSheet({ kind: "court", court: c })}
              />
            ))}
          </div>
        </>
      )}
      {shown.length > 0 && (
        <div class="cq-legend">
          <span>
            <i class="play" />
            {t("在打")}
          </span>
          <span>
            <i class="soon" />
            {t("{n} 分钟内到时间", { n: QUEUE_SOON_MIN })}
          </span>
          <span>
            <i class="queue" />
            {t("排队")}
          </span>
          <span class="cq-tip">{t("点场可修改")}</span>
        </div>
      )}
      {sheet?.kind === "court" && (
        <CourtSheet base={props.base} e={props.e} q={q} court={sheet.court} now={now} onClose={close} onDone={done} />
      )}
      {sheet?.kind === "accounts" && (
        <AccountsSheet base={props.base} e={props.e} q={q} onClose={close} onChange={props.onChange} />
      )}
    </div>
  );
}

/** One court: a block with a dashed net across it; the group's names split over the two halves. */
function CourtTile(props: { c: QueueCourt; tone: "play" | "soon" | "queue"; line: string; onOpen: () => void }) {
  const names = props.c.accounts;
  const half = (xs: string[]) => (
    <div class="cq-half">
      {xs.map((n) => (
        <span key={n}>{n}</span>
      ))}
    </div>
  );
  return (
    <button type="button" class={`cq-court ${props.tone}`} onClick={props.onOpen}>
      <span class="cq-court-head">
        <b>{t("{n}号", { n: props.c.court })}</b>
        <small>{props.line}</small>
      </span>
      <span class="cq-block">
        {half(names.filter((_, i) => i % 2 === 0))}
        <i class="cq-net" />
        {half(names.filter((_, i) => i % 2 === 1))}
      </span>
    </button>
  );
}

function SheetFrame(props: {
  title: ComponentChildren;
  label: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  // Into <body>, like the share sheet: the card's backdrop-filter would trap a fixed sheet inside it.
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside is a mouse shortcut; Esc and ✕ close it too
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet cq-sheet" role="dialog" aria-label={props.label}>
        <div class="sheet-head">
          <strong>{props.title}</strong>
          <button type="button" class="sheet-close" aria-label={t("关闭")} onClick={props.onClose}>
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 登记球场 / 修改: court, playing or which group in the queue, the minutes, and which shared
 * accounts. A new queued court asks for the screen's Minutes Left and works out the wait; a
 * correction asks for the wait itself. Either way the count starts again from now.
 */
function CourtSheet(props: {
  base: string;
  e: MyEvent;
  q: QueueInfo;
  court: QueueCourt | null;
  now: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const c = props.court;
  const phase = c ? courtPhase(c, props.now) : null;
  // A queued group whose time has come is edited as playing.
  const startPos = !c ? 0 : phase?.phase === "queued" ? c.position : 0;
  const [court, setCourt] = useState(c ? String(c.court) : "");
  const [position, setPosition] = useState(startPos);
  const [minutes, setMinutes] = useState(phase && phase.phase !== "done" ? String(phase.minutes) : "");
  const [picked, setPicked] = useState<string[]>(c?.accounts ?? []);
  const { busy, error, run } = useAction();
  const path = `${props.base}/events/${props.e.id}/queue/courts`;
  const n = Number(minutes);
  const fromScreen = !c && position > 0;
  const wait = fromScreen && minutes !== "" ? queueWait(n, position, props.q.roundMin) : null;

  function toggle(name: string) {
    if (picked.includes(name)) setPicked(picked.filter((x) => x !== name));
    else if (picked.length < QUEUE_GROUP_MAX) setPicked([...picked, name]);
  }
  async function save() {
    const body = {
      id: c?.id,
      court: Number(court),
      position,
      minutes: wait ?? n,
      accounts: picked,
    };
    if (await run(() => api(path, body))) props.onDone();
  }
  async function remove() {
    if (!confirm(position === 0 ? t("删除这片场（提前结束，不打了）？") : t("删除这组排队（不排了）？"))) return;
    if (await run(() => api(`${path}/${c!.id}/remove`, {}))) props.onDone();
  }

  const label =
    position === 0 ? t("还剩几分钟") : fromScreen ? t("这片场正在打的那组还剩几分钟") : t("还要等几分钟上场");
  return (
    <SheetFrame title={c ? t("{n} 号场", { n: c.court }) : t("登记球场")} label={t("登记球场")} onClose={props.onClose}>
      {c && (
        <p class="muted small">
          {c.updatedAt === c.createdAt
            ? t("{name} {time} 登记", { name: c.createdBy, time: toPacific(c.createdAt).time })
            : t("{a} {t1} 登记，{b} {t2} 修改", {
                a: c.createdBy,
                t1: toPacific(c.createdAt).time,
                b: c.updatedBy,
                t2: toPacific(c.updatedAt).time,
              })}
        </p>
      )}
      <CourtNumber value={court} onChange={setCourt} q={props.q} now={props.now} except={c?.id ?? null} />
      <p class="sheet-label">{t("状态")}</p>
      <div class="seg">
        {Array.from({ length: QUEUE_MAX_POSITION + 1 }, (_, k) => (
          <button type="button" key={k} class={position === k ? "on" : ""} onClick={() => setPosition(k)}>
            {k === 0 ? t("在打") : t("排第 {k} 组", { k })}
          </button>
        ))}
      </div>
      <p class="sheet-label">{label}</p>
      <div class="cq-minutes">
        <button type="button" onClick={() => setMinutes(String(Math.max(0, (n || 0) - 5)))}>
          −5
        </button>
        <label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={minutes}
            aria-label={label}
            onInput={(ev) => setMinutes((ev.target as HTMLInputElement).value)}
          />
          <span>{t("分钟")}</span>
        </label>
        <button type="button" onClick={() => setMinutes(String((n || 0) + 5))}>
          +5
        </button>
      </div>
      <p class="muted small">
        {wait !== null
          ? t("按每轮 {r} 分钟估算：大约 {n} 分钟后上场。", { r: props.q.roundMin, n: wait })
          : position > 0
            ? t("前面有人提前下场或退出，就把时间改短。到点会自动变成「在打」。")
            : t("屏幕上的 Minutes Left。保存后从现在开始倒计时。")}
      </p>
      <p class="sheet-label">{t("用了哪几个账号（1-{n} 个）", { n: QUEUE_GROUP_MAX })}</p>
      {props.q.accounts.length === 0 && (
        <p class="muted small">{t("还没有人添加球馆账号，请先在「球馆账号」里添加。")}</p>
      )}
      <AccountPicker q={props.q} now={props.now} except={c?.id ?? null} picked={picked} onToggle={toggle} />
      {error && <p class="error">{error}</p>}
      <button type="button" class="button block" disabled={busy} onClick={save}>
        {t("保存")}
      </button>
      {c && (
        <button type="button" class="button danger block" disabled={busy} onClick={remove}>
          {position === 0 ? t("删除（提前结束，不打了）") : t("删除（不排了）")}
        </button>
      )}
    </SheetFrame>
  );
}

/** Which courts each account is on right now (playing or queued), leaving out the entry being edited. */
/** Courts the dropdown lists; a higher number can still be typed, up to QUEUE_COURT_MAX. */
const COURT_LIST = 60;

/**
 * 场号: type it, or pick it from a dropdown of court numbers. Typing narrows the list; courts we
 * already hold are marked.
 */
function CourtNumber(props: {
  value: string;
  onChange: (v: string) => void;
  q: QueueInfo;
  now: number;
  except: number | null;
}) {
  const [open, setOpen] = useState(false);
  const held = new Set(
    props.q.courts
      .filter((c) => c.id !== props.except && courtPhase(c, props.now).phase !== "done")
      .map((c) => c.court),
  );
  const all = Array.from({ length: COURT_LIST }, (_, i) => i + 1);
  const typed = props.value.trim();
  // Typing narrows the list to numbers that start with it; a finished number shows them all again.
  const narrowed = all.filter((n) => String(n).startsWith(typed));
  const shown = typed && narrowed.some((n) => String(n) !== typed) ? narrowed : all;
  return (
    <div class="cq-court-no">
      <label for="cq-court-no" class="sheet-label">
        {t("场号")}
      </label>
      <div class="cq-combo">
        <input
          id="cq-court-no"
          type="number"
          inputMode="numeric"
          min={1}
          max={QUEUE_COURT_MAX}
          placeholder={t("选择或输入")}
          value={props.value}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onInput={(ev) => {
            props.onChange((ev.target as HTMLInputElement).value);
            setOpen(true);
          }}
        />
        <button
          type="button"
          class="cq-combo-toggle"
          aria-label={t("选择场号")}
          aria-expanded={open}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => setOpen(!open)}
        >
          ▾
        </button>
      </div>
      {open && shown.length > 0 && (
        <div class="cq-court-list" role="listbox" aria-label={t("场号")}>
          {shown.map((n) => (
            <button
              type="button"
              role="option"
              key={n}
              aria-selected={String(n) === typed}
              class={`${String(n) === typed ? "on" : ""}${held.has(n) ? " held" : ""}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => {
                props.onChange(String(n));
                setOpen(false);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function busyAccounts(q: QueueInfo, now: number, except: number | null): Map<string, number[]> {
  const busy = new Map<string, number[]>();
  for (const c of q.courts) {
    if (c.id === except || courtPhase(c, now).phase === "done") continue;
    for (const a of c.accounts) busy.set(a.toLowerCase(), [...(busy.get(a.toLowerCase()) ?? []), c.court]);
  }
  return busy;
}

/** A search box over many accounts (Ke Li: thirty to fifty a night). */
function Search(props: { value: string; onInput: (v: string) => void }) {
  return (
    <input
      class="cq-search"
      type="search"
      placeholder={t("搜索账号")}
      aria-label={t("搜索账号")}
      autocapitalize="none"
      autocorrect="off"
      spellcheck={false}
      value={props.value}
      onInput={(ev) => props.onInput((ev.target as HTMLInputElement).value)}
    />
  );
}

const matches = (name: string, query: string) => name.toLowerCase().includes(query.trim().toLowerCase());

/**
 * The group's accounts: the picked ones in their own highlighted row on top, then the free ones,
 * then those already on another court (marked with it), so with thirty or more accounts the likely
 * ones are near the top.
 */
function AccountPicker(props: {
  q: QueueInfo;
  now: number;
  except: number | null;
  picked: string[];
  onToggle: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const busy = busyAccounts(props.q, props.now, props.except);
  const rank = (name: string) => (busy.has(name.toLowerCase()) ? 1 : 0);
  const list = props.q.accounts
    .filter((a) => !props.picked.includes(a.username) && matches(a.username, query))
    .sort((a, b) => rank(a.username) - rank(b.username));
  if (props.q.accounts.length === 0) return null;
  return (
    <>
      <div class="cq-picked">
        <span class="cq-picked-label">{t("已选 {n}/{max}", { n: props.picked.length, max: QUEUE_GROUP_MAX })}</span>
        {props.picked.length === 0 && <span class="muted small">{t("点下面的账号选上")}</span>}
        {props.picked.map((name) => {
          const password = props.q.accounts.find((a) => a.username === name)?.password;
          return (
            <button
              type="button"
              key={name}
              class="chip on cq-pick"
              aria-label={t("取消选择 {name}", { name })}
              onClick={() => props.onToggle(name)}
            >
              <span class="cq-pick-name">
                ✓ {name} <span aria-hidden="true">✕</span>
              </span>
              {password && <small>{password}</small>}
            </button>
          );
        })}
      </div>
      {props.q.accounts.length > SEARCH_FROM && <Search value={query} onInput={setQuery} />}
      <div class="chips cq-chips">
        {list.map((a) => {
          const on = busy.get(a.username.toLowerCase());
          return (
            <button
              type="button"
              key={a.id}
              class={on ? "chip cq-busy" : "chip"}
              onClick={() => props.onToggle(a.username)}
            >
              {a.username}
              {on && <small>{t("{n}号", { n: on.join("、") })}</small>}
            </button>
          );
        })}
        {list.length === 0 && query && <p class="muted small">{t("没有找到这个账号")}</p>}
      </div>
    </>
  );
}

/** 球馆账号: everyone's hall accounts for this event; add your own, take off the ones you added. */
function AccountsSheet(props: { base: string; e: MyEvent; q: QueueInfo; onClose: () => void; onChange: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const { busy, error, run } = useAction();
  const path = `${props.base}/events/${props.e.id}/queue/accounts`;
  const inUse = busyAccounts(props.q, Date.now(), null);
  const shown = props.q.accounts.filter((a) => matches(a.username, query));
  // The list on screen follows what the card last fetched, so it updates as accounts come and go.
  async function add() {
    if (await run(() => api(path, { username, password }))) {
      setUsername("");
      setPassword("");
      props.onChange();
    }
  }
  async function remove(id: number, name: string) {
    if (!confirm(t("删除账号 {name}？", { name }))) return;
    if (await run(() => api(`${path}/${id}/remove`, {}))) props.onChange();
  }
  return (
    <SheetFrame
      title={t("球馆账号（{n}）", { n: props.q.accounts.length })}
      label={t("球馆账号")}
      onClose={props.onClose}
    >
      <p class="muted small">{t("报名这场的人都能看到这些账号和密码。")}</p>
      <p class="sheet-label">{t("添加账号（可以加好几个）")}</p>
      <div class="cq-add">
        <Field label={t("用户名")} value={username} onInput={setUsername} autocomplete="off" verbatim />
        <Field label={t("密码")} value={password} onInput={setPassword} autocomplete="off" verbatim />
      </div>
      {error && <p class="error">{error}</p>}
      <button type="button" class="button block" disabled={busy || !username.trim()} onClick={add}>
        {t("添加")}
      </button>
      {props.q.accounts.length > SEARCH_FROM && <Search value={query} onInput={setQuery} />}
      {shown.length > 0 && (
        <ul class="cq-accounts">
          {shown.map((a) => {
            const on = inUse.get(a.username.toLowerCase());
            return (
              <li key={a.id}>
                <span class="cq-account">
                  {a.username} · {a.password}
                  {on && <small class="cq-on">{t("{n}号", { n: on.join("、") })}</small>}
                </span>
                <span class="muted small">
                  {t("{name} 提供", { name: a.addedBy })}
                  {(a.mine || props.e.runByMe) && (
                    <button type="button" class="text-button" disabled={busy} onClick={() => remove(a.id, a.username)}>
                      {t("删除")}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SheetFrame>
  );
}
