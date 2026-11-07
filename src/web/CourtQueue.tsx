import { Panel } from "./Panel";
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  courtLeft,
  courtPhase,
  idleAccounts,
  idleTooMany,
  PHOTO_MAX_SIDE,
  type PhotoCourt,
  type PhotoResult,
  QUEUE_COURT_MAX,
  QUEUE_GROUP_MAX,
  QUEUE_MAX_POSITION,
  QUEUE_SOON_MIN,
  type QueueAccount,
  type QueueCourt,
  parseAccountList,
  type QueueInfo,
  queueWait,
  replacedBy,
} from "../shared/courtQueue";
import { toPacific } from "../shared/time";
import type { MyEvent } from "../shared/types";
import { api } from "./api";
import { CourtCombo } from "./CourtCombo";
import { useAction } from "./components";
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

type Sheet = { kind: "court"; court: QueueCourt | null } | null;

/**
 * 球场: the courts we hold and queue for, each drawn as a court with our hall usernames on its two
 * halves (Ke Li's design: four to a row, names stacked). The two buttons stay at the top of the
 * screen and the colour key at the bottom while the courts are on screen.
 */
export function CourtQueue(props: { base: string; e: MyEvent; onChange: () => void }) {
  const q = props.e.queue!;
  const now = useNow();
  const [sheet, setSheet] = useState<Sheet>(null);
  // 选择 (the Owner and admins): the ticked courts' ids; null when not choosing.
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const { busy, error, run } = useAction();

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
  const choosing = q.manage && picked !== null;
  const open = (c: QueueCourt) => {
    if (!choosing) return setSheet({ kind: "court", court: c });
    const next = new Set(picked);
    if (!next.delete(c.id)) next.add(c.id);
    setPicked(next);
  };
  // Ticked courts that have ended since drop off the screen, so they aren't counted or deleted.
  const ticked = choosing ? shown.filter(({ c }) => picked.has(c.id)).map(({ c }) => c.id) : [];
  const allTicked = ticked.length === shown.length;
  async function removePicked() {
    if (!confirm(t("删除选中的 {n} 片场和排队？", { n: ticked.length }))) return;
    const path = `${props.base}/events/${props.e.id}/queue/courts/remove`;
    if (await run(() => api(path, { ids: ticked }))) {
      setPicked(null);
      props.onChange();
    }
  }

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
      {/* One button (Ke Li 2026-11-07): 球馆账号 lives inside 登记球场 now. */}
      <div class="cq-bar">
        <button type="button" class="button" onClick={() => setSheet({ kind: "court", court: null })}>
          {t("＋ 登记球场")}
        </button>
        <IdleNotice q={q} now={now} />
      </div>
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
                picked={choosing ? picked.has(c.id) : undefined}
                onOpen={() => open(c)}
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
                picked={choosing ? picked.has(c.id) : undefined}
                onOpen={() => open(c)}
              />
            ))}
          </div>
        </>
      )}
      {error && <p class="error">{error}</p>}
      {shown.length > 0 && choosing && (
        <div class="cq-legend cq-pickbar">
          <span>{t("已选 {n} 个", { n: ticked.length })}</span>
          <button
            type="button"
            class="text-button"
            onClick={() => setPicked(new Set(allTicked ? [] : shown.map(({ c }) => c.id)))}
          >
            {allTicked ? t("全不选") : t("全选")}
          </button>
          <span class="cq-pickbar-end">
            <button type="button" class="button secondary" disabled={busy} onClick={() => setPicked(null)}>
              {t("取消")}
            </button>
            <button type="button" class="button danger" disabled={busy || ticked.length === 0} onClick={removePicked}>
              {t("批量删除")}
            </button>
          </span>
        </div>
      )}
      {shown.length > 0 && !choosing && (
        <div class="cq-legend">
          <span>
            <i class="play" />
            {t("在打")}
          </span>
          <span>
            <i class="soon" />
            {t("{n} 分钟内", { n: QUEUE_SOON_MIN })}
          </span>
          <span>
            <i class="queue" />
            {t("排队")}
          </span>
          {q.manage && (
            <button type="button" class="text-button cq-pick-start" onClick={() => setPicked(new Set())}>
              {t("选择")}
            </button>
          )}
        </div>
      )}
      {sheet?.kind === "court" && (
        <CourtSheet
          base={props.base}
          e={props.e}
          q={q}
          court={sheet.court}
          now={now}
          onClose={close}
          onDone={done}
          onSaved={props.onChange}
        />
      )}
    </div>
  );
}

/**
 * 空闲账号提醒 (Ke Li, option C): while the event is on and at least the threshold set in 设置 of
 * the shared accounts are neither on a court nor queued, a thin strip under the two buttons says
 * how many, and stays on screen with them.
 */
function IdleNotice(props: { q: QueueInfo; now: number }) {
  const a = props.q.idleAlert;
  if (!a || props.now < Date.parse(a.from) || props.now >= Date.parse(a.to)) return null;
  const all = props.q.accounts.map((x) => x.username);
  const idle = idleAccounts(all, props.q.courts, props.now).length;
  if (!idleTooMany(idle, all.length, a.pct)) return null;
  return (
    <div class="cq-idle" role="status">
      {t("⚠️ {n} 个账号空着（{share}%）", { n: idle, share: Math.round((idle * 100) / all.length) })}
    </div>
  );
}

/**
 * Where each of our accounts stands on a court, as quarters: top-left, top-right, bottom-left,
 * bottom-right. One account a quarter (Ke Li): the first two face each other across the net down
 * the left side, the third takes the top right, the fourth the bottom right. Quarters without one
 * of our accounts are someone else's or empty; the hall's screen doesn't say which, so they are
 * drawn alike (striped).
 */
const QUARTER_ORDER = [0, 2, 1, 3] as const;
export const quarters = (names: string[]): (string | null)[] => {
  const out: (string | null)[] = [null, null, null, null];
  names.slice(0, 4).forEach((n, i) => {
    out[QUARTER_ORDER[i] ?? 3] = n;
  });
  return out;
};

/** One court: four quarters with a dashed net across the middle; our accounts fill theirs. */
function CourtTile(props: {
  c: QueueCourt;
  tone: "play" | "soon" | "queue";
  line: string;
  /** While choosing courts to delete: whether this one is ticked. */
  picked?: boolean;
  onOpen: () => void;
}) {
  const choosing = props.picked !== undefined;
  return (
    <button
      type="button"
      class={`cq-court ${props.tone}${props.picked ? " picked" : ""}`}
      aria-pressed={choosing ? props.picked : undefined}
      onClick={props.onOpen}
    >
      <span class="cq-court-head">
        <b>{t("{n}号", { n: props.c.court })}</b>
        <small>{props.line}</small>
        {choosing && <i class="cq-check" aria-hidden="true" />}
      </span>
      <span class="cq-block">
        {quarters(props.c.accounts).map((n, i) => (
          <span key={i} class={`cq-q${n ? " ours" : ""}`}>
            {n && <span>{n}</span>}
          </span>
        ))}
        <i class="cq-net" />
        <i class="cq-mid" />
      </span>
    </button>
  );
}

function SheetFrame(props: {
  title: ComponentChildren;
  label: string;
  onClose: () => void;
  action?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <Panel
      title={props.title ?? props.label}
      label={props.label}
      onClose={props.onClose}
      action={props.action}
      class="cq-sheet"
    >
      {props.children}
    </Panel>
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
  /** After one of several courts from a photo is saved: refresh, keep the sheet open for the next. */
  onSaved: () => void;
}) {
  const c = props.court;
  const phase = c ? courtPhase(c, props.now) : null;
  // A queued group whose time has come is edited as playing.
  const startPos = !c ? 0 : phase?.phase === "queued" ? c.position : 0;
  const [court, setCourt] = useState(c ? String(c.court) : "");
  const [position, setPosition] = useState(startPos);
  const [minutes, setMinutes] = useState(phase && phase.phase !== "done" ? String(phase.minutes) : "");
  const [picked, setPicked] = useState<string[]>(c?.accounts ?? []);
  // 拍照登记: the courts read from the photo, which one the form shows, and which are saved.
  const [photo, setPhoto] = useState<{ url: string; result: PhotoResult } | null>(null);
  const [at, setAt] = useState(0);
  const [saved, setSaved] = useState<number[]>([]);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [noMinutes, setNoMinutes] = useState(false);
  // A court read from the photo that is already on the card is saved as a change to that entry.
  const [entryId, setEntryId] = useState<number | null>(null);
  const [missing, setMissing] = useState(false);
  const { busy, error, run } = useAction();
  // 球馆账号 inside 登记球场 (设置, Ke Li): two tabs, or the list here with 账号管理 on top of it.
  const tabs = props.q.accountsView === "tabs";
  const [tab, setTab] = useState<"court" | "accounts">("court");
  const [manage, setManage] = useState(false);
  const bar = useAccountsBar();
  const path = `${props.base}/events/${props.e.id}/queue/courts`;
  const fromScreen = !c && position > 0;
  // A new queued group with the box left empty: the group playing on that court (if it is on the
  // card) has this long left, so the wait counts from it, not from 0.
  const playingLeft = fromScreen ? courtLeft(props.q.courts, Number(court), props.now) : null;
  const n = minutes === "" && playingLeft !== null ? playingLeft : Number(minutes);
  const wait = fromScreen && (minutes !== "" || playingLeft !== null) ? queueWait(n, position, props.q.roundMin) : null;

  function toggle(name: string) {
    if (picked.includes(name)) setPicked(picked.filter((x) => x !== name));
    else if (picked.length < QUEUE_GROUP_MAX) setPicked([...picked, name]);
  }
  function fill(p: PhotoCourt, k: number) {
    setAt(k);
    setCourt(String(p.court));
    setPosition(p.position);
    setMinutes(p.minutesLeft === null ? "" : String(p.minutesLeft));
    setNoMinutes(p.minutesLeft === null);
    setPicked(p.accounts.map((a) => a.username));
    setUnsure(p.accounts.filter((a) => a.uncertain).map((a) => a.username));
    const same = props.q.courts.find((x) =>
      replacedBy(x, { court: p.court, position: p.position, accounts: p.accounts.map((a) => a.username) }, props.now),
    );
    setEntryId(same?.id ?? null);
  }
  function read(url: string, result: PhotoResult) {
    setPhoto({ url, result });
    setSaved([]);
    setSkipped([]);
    if (result.courts.length > 0) fill(result.courts[0]!, 0);
  }
  /**
   * ✕ on a court read from the photo (Ke Li: someone else's account read as ours): it isn't saved.
   * Tapping a skipped court brings it back and shows it; skipping the one shown moves to the next.
   */
  function skip(k: number) {
    const found = photo!.result.courts;
    if (skipped.includes(k)) {
      setSkipped(skipped.filter((x) => x !== k));
      return fill(found[k]!, k);
    }
    const sk = [...skipped, k];
    setSkipped(sk);
    if (k !== at) return;
    const next = found.findIndex((_, j) => !saved.includes(j) && !sk.includes(j));
    if (next < 0) return props.onDone();
    fill(found[next]!, next);
  }
  async function save() {
    if (fromScreen && wait === null) return setMissing(true);
    const body = {
      id: c?.id ?? entryId ?? undefined,
      court: Number(court),
      position,
      minutes: wait ?? n,
      accounts: picked,
    };
    if (!(await run(() => api(path, body)))) return;
    const found = photo?.result.courts ?? [];
    const done = [...saved, at];
    const next = found.findIndex((_, k) => !done.includes(k) && !skipped.includes(k));
    if (!photo || next < 0) return props.onDone();
    setSaved(done);
    fill(found[next]!, next);
    props.onSaved();
  }
  async function remove() {
    if (!confirm(position === 0 ? t("删除这片场（提前结束，不打了）？") : t("删除这组排队（不排了）？"))) return;
    if (await run(() => api(`${path}/${c!.id}/remove`, {}))) props.onDone();
  }

  const label = position === 0 ? t("还剩几分钟") : fromScreen ? t("正在打的还剩几分钟") : t("还要等几分钟");
  // The slider reaches one round for a court's time left, else the whole wait for that group.
  const sliderMax = Math.max(position === 0 || fromScreen ? props.q.roundMin : position * props.q.roundMin, n || 0);
  return (
    <SheetFrame
      title={c ? t("{n} 号场", { n: c.court }) : null}
      label={t("登记球场")}
      onClose={props.onClose}
      action={
        tabs ? (
          tab === "accounts" && <AccountsActions q={props.q} bar={bar} />
        ) : (
          <button type="button" onClick={() => setManage(true)}>
            {t("账号管理")}
          </button>
        )
      }
    >
      {tabs && (
        <div class="seg cq-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "court"}
            class={tab === "court" ? "on" : ""}
            onClick={() => setTab("court")}
          >
            {t("登记球场")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "accounts"}
            class={tab === "accounts" ? "on" : ""}
            onClick={() => setTab("accounts")}
          >
            {t("球馆账号（{n}）", { n: props.q.accounts.length })}
          </button>
        </div>
      )}
      {/* Kept while the other tab shows, so what was typed stays. */}
      <div hidden={tab !== "court"}>
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
        {!c && props.q.photo && (
          <PhotoButton path={`${props.base}/events/${props.e.id}/queue/photo`} onRead={read} disabled={busy} />
        )}
        {photo && (
          <PhotoFound
            url={photo.url}
            result={photo.result}
            at={at}
            saved={saved}
            skipped={skipped}
            onPick={(k) => fill(photo.result.courts[k]!, k)}
            onSkip={skip}
          />
        )}
        <div class="cq-row">
          <CourtNumber value={court} onChange={setCourt} q={props.q} now={props.now} except={c?.id ?? null} />
          <div>
            <div class="seg cq-status" role="group" aria-label={t("状态")}>
              {Array.from({ length: QUEUE_MAX_POSITION + 1 }, (_, k) => (
                <button
                  type="button"
                  key={k}
                  class={position === k ? "on" : ""}
                  aria-label={k === 0 ? t("在打") : t("排第 {k} 组", { k })}
                  onClick={() => setPosition(k)}
                >
                  {k === 0 ? t("在打") : t("排{k}", { k })}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Typed in the box, or dragged on the slider right beside it. */}
        <div class={noMinutes && minutes === "" ? "cq-minutes cq-unsure" : "cq-minutes"}>
          <label class="cq-minutes-box">
            <span>{position === 0 || fromScreen ? t("剩余") : t("等待")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={minutes}
              placeholder={playingLeft !== null ? String(playingLeft) : undefined}
              aria-label={label}
              onInput={(ev) => {
                setMinutes((ev.target as HTMLInputElement).value);
                setMissing(false);
              }}
            />
            <span>{t("分钟")}</span>
          </label>
          <input
            class="cq-slider"
            type="range"
            min={0}
            max={sliderMax}
            step={1}
            value={n || 0}
            aria-label={label}
            onInput={(ev) => {
              setMinutes((ev.target as HTMLInputElement).value);
              setMissing(false);
            }}
          />
        </div>
        {missing && minutes === "" && <p class="error">{t("请填写正在打的还剩几分钟")}</p>}
        {noMinutes && minutes === "" && <p class="cq-unsure-note small">{t("照片上没读出剩余时间，请看屏幕填写。")}</p>}
        <p class="muted small">
          {wait !== null
            ? t("按每轮 {r} 分钟估算：大约 {n} 分钟后上场。", { r: props.q.roundMin, n: wait })
            : position > 0
              ? t("前面有人提前下场或退出，就把时间改短。到点会自动变成「在打」。")
              : t("屏幕上的 Minutes Left。保存后从现在开始倒计时。")}
        </p>
        {tabs && props.q.accounts.length === 0 && (
          <p class="muted small">{t("还没有人添加球馆账号，请先在「球馆账号」里添加。")}</p>
        )}
        {picked.some((name) => unsure.includes(name)) && (
          <p class="cq-unsure-note small">{t("黄色的账号照片上看不太清，请对照球馆屏幕核对。")}</p>
        )}
        <AccountPicker
          q={props.q}
          now={props.now}
          except={c?.id ?? null}
          picked={picked}
          unsure={unsure}
          onToggle={toggle}
          addPath={tabs ? undefined : `${props.base}/events/${props.e.id}/queue/accounts`}
          onAdded={(name) => {
            if (picked.length < QUEUE_GROUP_MAX) setPicked([...picked, name]);
            props.onSaved();
          }}
        />
        {error && <p class="error">{error}</p>}
        <button type="button" class="button block" disabled={busy} onClick={save}>
          {t("保存")}
        </button>
        {c && (
          <button type="button" class="button danger block" disabled={busy} onClick={remove}>
            {position === 0 ? t("删除（提前结束，不打了）") : t("删除（不排了）")}
          </button>
        )}
      </div>
      {tab === "accounts" && (
        <AccountsList base={props.base} e={props.e} q={props.q} bar={bar} onChange={props.onSaved} />
      )}
      {manage && (
        <AccountsSheet
          base={props.base}
          e={props.e}
          q={props.q}
          onClose={() => setManage(false)}
          onChange={props.onSaved}
        />
      )}
    </SheetFrame>
  );
}

/**
 * The photo shrunk to PHOTO_MAX_SIDE on its long side and saved as JPEG (Ke Li: 照片分辨率请压缩), as
 * base64 for the request; about 300 KB from a phone's 3-5 MB.
 */
async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.8));
  if (!blob) throw new Error("toBlob");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 拍照登记: take or pick a photo of the hall's screen; what is read fills the form below. */
function PhotoButton(props: { path: string; disabled: boolean; onRead: (url: string, r: PhotoResult) => void }) {
  const { busy, error, run } = useAction();
  async function pick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // the same photo can be picked again after a failure
    if (!file) return;
    await run(async () => {
      let image: string;
      try {
        image = await shrinkPhoto(file);
      } catch {
        throw new Error(t("这张照片打不开，请重新拍一张"));
      }
      const result = await api<PhotoResult>(props.path, { image });
      props.onRead(`data:image/jpeg;base64,${image}`, result);
    });
  }
  return (
    <div class="cq-photo">
      <label class={`button secondary block cq-photo-button${busy || props.disabled ? " disabled" : ""}`}>
        <input type="file" accept="image/*" disabled={busy || props.disabled} onChange={pick} />
        {busy ? t("识别中…") : t("📷 拍照登记")}
      </label>
      {error && <p class="error">{error}</p>}
    </div>
  );
}

/** What the photo showed: the photo to check against, and the courts found, one form at a time. */
function PhotoFound(props: {
  url: string;
  result: PhotoResult;
  at: number;
  saved: number[];
  skipped: number[];
  onPick: (k: number) => void;
  onSkip: (k: number) => void;
}) {
  const [big, setBig] = useState(false);
  const found = props.result.courts;
  return (
    <div class="cq-found">
      <button type="button" class={big ? "cq-photo-view big" : "cq-photo-view"} onClick={() => setBig(!big)}>
        <img src={props.url} alt={t("排队屏幕照片")} />
      </button>
      {found.length === 0 ? (
        <p class="muted small">{t("照片上没有找到我们的账号。可以重拍一张，或者手动填写。")}</p>
      ) : (
        <>
          <p class="sheet-label">
            {found.length > 1
              ? t("找到 {n} 片场，请注意逐个核对后保存", { n: found.length })
              : t("找到 1 片场，请注意核对后保存")}
          </p>
          {found.length > 1 && (
            <div class="chips cq-found-list">
              {found.map((p, k) => {
                const done = props.saved.includes(k);
                const skip = props.skipped.includes(k);
                return (
                  <span class="chip-wrap" key={`${p.court}:${p.position}`}>
                    <button
                      type="button"
                      class={`chip${k === props.at && !skip ? " on" : ""}${done ? " cq-done" : ""}${skip ? " cq-skipped" : ""}`}
                      onClick={() => (skip ? props.onSkip(k) : props.onPick(k))}
                    >
                      {done ? "✓ " : ""}
                      <span class="cq-found-name">
                        {t("{n}号", { n: p.court })} ·{" "}
                        {p.position === 0 ? t("在打") : t("排第 {k} 组", { k: p.position })}
                      </span>
                    </button>
                    {!done && !skip && (
                      <button
                        type="button"
                        class="chip-remove"
                        aria-label={t("跳过 {n}号", { n: p.court })}
                        onClick={() => props.onSkip(k)}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </>
      )}
      {props.result.unreadable.length > 0 && (
        <p class="muted small">
          {t("{n}号场在照片上看不清，有我们的人的话请手动登记。", { n: props.result.unreadable.join("、") })}
        </p>
      )}
    </div>
  );
}

/** Which courts each account is on right now (playing or queued), leaving out the entry being edited. */
/** Courts the dropdown lists; a higher number can still be typed, up to QUEUE_COURT_MAX. */
const COURT_LIST = 60;

/** 场号, marking the courts we already hold. */
function CourtNumber(props: {
  value: string;
  onChange: (v: string) => void;
  q: QueueInfo;
  now: number;
  except: number | null;
}) {
  const held = new Set(
    props.q.courts
      .filter((c) => c.id !== props.except && courtPhase(c, props.now).phase !== "done")
      .map((c) => c.court),
  );
  const typed = props.value.trim();
  return (
    <CourtCombo
      id="cq-court-no"
      label={t("场号")}
      labelHidden
      placeholder={t("场号")}
      toggleLabel={t("选择场号")}
      value={props.value}
      onInput={props.onChange}
      list={COURT_LIST}
      max={QUEUE_COURT_MAX}
      isOn={(n) => String(n) === typed}
      isMarked={(n) => held.has(n)}
      onPick={(n) => props.onChange(String(n))}
    />
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

type AccountSort = "az" | "za" | "new";
/** 球馆账号's sort button, tapped round: A→Z, Z→A, newest added first. */
const SORTS: Record<AccountSort, { label: () => string; compare: (a: QueueAccount, b: QueueAccount) => number }> = {
  az: { label: () => "A→Z", compare: (a, b) => byName(a, b) },
  za: { label: () => "Z→A", compare: (a, b) => byName(b, a) },
  new: { label: () => t("最新添加"), compare: (a, b) => b.id - a.id },
};

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        d="M6 3v13M6 16l-3-3M6 16l3-3M14 17V4M14 4l-3 3M14 4l3 3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Accounts in alphabetical order, ignoring case (Ke Li). */
const byName = (a: { username: string }, b: { username: string }) =>
  a.username.localeCompare(b.username, "en", { sensitivity: "base" });

/**
 * The group's accounts: the picked ones in their own highlighted row on top, then all the others
 * in alphabetical order (those already on another court dimmed and marked with it), in a box that
 * scrolls when there are many.
 */
function AccountPicker(props: {
  q: QueueInfo;
  now: number;
  except: number | null;
  picked: string[];
  /** Read off a photo without being sure of the name: marked yellow to check. */
  unsure?: string[];
  onToggle: (name: string) => void;
  /**
   * 球馆账号 listed here (设置 「列在登记球场里」): each account shows its password, and
   * 「＋ 新账号」 adds one in place through this path; the new one comes back through onAdded.
   */
  addPath?: string;
  onAdded?: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { busy: saving, error, run } = useAction();
  const busy = busyAccounts(props.q, props.now, props.except);
  const list = props.q.accounts
    .filter((a) => !props.picked.includes(a.username) && matches(a.username, query))
    .sort(byName);
  const inline = props.addPath !== undefined;
  if (props.q.accounts.length === 0 && !inline) return null;
  async function add() {
    const name = username.trim();
    if (!name || !(await run(() => api(props.addPath!, { username: name, password })))) return;
    setUsername("");
    setPassword("");
    setAdding(false);
    props.onAdded?.(name);
  }
  return (
    <>
      {/* Four places in one row (Ke Li, option P2); the empty ones dashed. */}
      <div class="cq-picked">
        {props.picked.map((name) => {
          const password = props.q.accounts.find((a) => a.username === name)?.password;
          return (
            <button
              type="button"
              key={name}
              class={props.unsure?.includes(name) ? "chip on cq-pick cq-unsure" : "chip on cq-pick"}
              aria-label={t("取消选择 {name}", { name })}
              onClick={() => props.onToggle(name)}
            >
              <span class="cq-pick-name">✓ {name}</span>
              <span class="cq-pick-x" aria-hidden="true">
                ✕
              </span>
              {password && <small>{password}</small>}
            </button>
          );
        })}
        {Array.from({ length: Math.max(0, QUEUE_GROUP_MAX - props.picked.length) }, (_, k) => (
          <span key={`empty-${k}`} class="cq-slot" aria-hidden="true">
            {t("空位")}
          </span>
        ))}
      </div>
      {props.q.accounts.length > SEARCH_FROM && <Search value={query} onInput={setQuery} />}
      <div class={inline ? "chips cq-chips cq-chips-pw" : "chips cq-chips"}>
        {inline &&
          (adding ? (
            <form
              class="cq-add cq-add-inline"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!saving) add();
              }}
            >
              <input
                aria-label={t("用户名")}
                placeholder={t("用户名")}
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                spellcheck={false}
                value={username}
                onInput={(ev) => setUsername((ev.target as HTMLInputElement).value)}
              />
              <input
                aria-label={t("密码")}
                placeholder={t("密码")}
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                spellcheck={false}
                value={password}
                onInput={(ev) => setPassword((ev.target as HTMLInputElement).value)}
              />
              <button type="submit" class="cq-add-plus" aria-label={t("添加")} disabled={saving || !username.trim()}>
                <PlusIcon />
              </button>
            </form>
          ) : (
            <button type="button" class="chip cq-new" onClick={() => setAdding(true)}>
              {t("＋ 新账号")}
            </button>
          ))}
        {inline && error && <p class="error">{error}</p>}
        {list.map((a) => {
          const on = busy.get(a.username.toLowerCase());
          const court = on && t("{n}号", { n: on.join("、") });
          return (
            <button
              type="button"
              key={a.id}
              class={on ? "chip cq-busy" : "chip"}
              onClick={() => props.onToggle(a.username)}
            >
              {inline ? (
                <>
                  <span>{a.username}</span>
                  <small>{court ? `${a.password} · ${court}` : a.password}</small>
                </>
              ) : (
                <>
                  {a.username}
                  {on && <small>{court}</small>}
                </>
              )}
            </button>
          );
        })}
        {list.length === 0 && query && <p class="muted small">{t("没有找到这个账号")}</p>}
      </div>
    </>
  );
}

/** 球馆账号's top-bar buttons (sort, 批量添加) and the state they set, shared by its panel and its tab. */
function useAccountsBar() {
  const [sort, setSort] = useState<AccountSort>("az");
  const [batch, setBatch] = useState(false);
  return { sort, setSort, batch, setBatch };
}
type AccountsBar = ReturnType<typeof useAccountsBar>;

function AccountsActions(props: { q: QueueInfo; bar: AccountsBar }) {
  const bar = props.bar;
  return (
    <>
      {/* Sorting sits in the top bar too, so the list starts right under the add row (Ke Li). */}
      {props.q.accounts.length > 1 && (
        <button
          type="button"
          class="cq-sort-icon"
          aria-label={t("排序：{by}", { by: SORTS[bar.sort].label() })}
          title={SORTS[bar.sort].label()}
          onClick={() => bar.setSort(bar.sort === "az" ? "za" : bar.sort === "za" ? "new" : "az")}
        >
          <SortIcon />
        </button>
      )}
      <button type="button" aria-expanded={bar.batch} onClick={() => bar.setBatch(!bar.batch)}>
        {t("批量添加")}
      </button>
    </>
  );
}

/** 球馆账号: everyone's hall accounts for this event; add your own, take off the ones you added. */
function AccountsSheet(props: { base: string; e: MyEvent; q: QueueInfo; onClose: () => void; onChange: () => void }) {
  const bar = useAccountsBar();
  return (
    <SheetFrame
      title={t("球馆账号（{n}）", { n: props.q.accounts.length })}
      label={t("球馆账号")}
      onClose={props.onClose}
      action={<AccountsActions q={props.q} bar={bar} />}
    >
      <AccountsList base={props.base} e={props.e} q={props.q} bar={bar} onChange={props.onChange} />
    </SheetFrame>
  );
}

/** The accounts: add one, 批量添加, the list with 删除, 清空 (in the 球馆账号 panel or tab). */
function AccountsList(props: { base: string; e: MyEvent; q: QueueInfo; bar: AccountsBar; onChange: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const path = `${props.base}/events/${props.e.id}/queue/accounts`;
  const inUse = busyAccounts(props.q, Date.now(), null);
  // Free accounts first in the order picked; those on a court or queued below them, by court
  // number and then in the order picked (Ke Li).
  const order = SORTS[props.bar.sort].compare;
  // No search box (Ke Li, option S3): typing a 用户名 narrows the list, which also shows a repeat.
  const found = props.q.accounts.filter((a) => matches(a.username, username));
  const isOn = (a: { username: string }) => inUse.has(a.username.toLowerCase());
  const court = (a: { username: string }) => Math.min(...(inUse.get(a.username.toLowerCase()) ?? [0]));
  const shown = [
    ...found.filter((a) => !isOn(a)).sort(order),
    ...found.filter(isOn).sort((a, b) => court(a) - court(b) || order(a, b)),
  ];
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
  async function clear() {
    if (!confirm(t("清空这场的全部 {n} 个球馆账号？已登记的球场不受影响。", { n: props.q.accounts.length }))) return;
    if (await run(() => api(`${path}/clear`, {}))) props.onChange();
  }
  return (
    <>
      {/* One row (Ke Li, option F): the two boxes and ＋; 批量添加 is up in the top bar. */}
      <form
        class="cq-add"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!busy && username.trim()) add();
        }}
      >
        <input
          aria-label={t("用户名")}
          placeholder={t("用户名")}
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          value={username}
          onInput={(ev) => setUsername((ev.target as HTMLInputElement).value)}
        />
        <input
          aria-label={t("密码")}
          placeholder={t("密码")}
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          value={password}
          onInput={(ev) => setPassword((ev.target as HTMLInputElement).value)}
        />
        <button type="submit" class="cq-add-plus" aria-label={t("添加")} disabled={busy || !username.trim()}>
          <PlusIcon />
        </button>
      </form>
      {error && <p class="error">{error}</p>}
      {props.bar.batch && <BatchAdd path={`${path}/batch`} q={props.q} onDone={props.onChange} />}
      {shown.length > 0 && (
        <ul class="cq-accounts">
          {shown.map((a) => {
            const on = inUse.get(a.username.toLowerCase());
            return (
              <li key={a.id} class={on ? "on" : undefined}>
                <span class="cq-account">
                  {a.username} · {a.password}
                  {on && <small class="cq-on">{t("{n}号", { n: on.join("、") })}</small>}
                </span>
                <span class="muted small">
                  {t("{name} 提供", { name: a.addedBy })}
                  {(a.mine || props.e.runByMe || props.q.manage) && (
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
      {props.q.manage && props.q.accounts.length > 0 && (
        <button type="button" class="button danger cq-clear" disabled={busy} onClick={clear}>
          {t("清空全部账号")}
        </button>
      )}
    </>
  );
}

/**
 * 批量添加: paste a numbered list ("1. Cassie lion3", one account per line, a group note above
 * is skipped). It is read here exactly as typed, and the preview says what will be added, what is
 * already on the event and which lines couldn't be read, before anything is saved.
 */
function BatchAdd(props: { path: string; q: QueueInfo; onDone: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ added: number; skipped: string[] } | null>(null);
  const { busy, error, run } = useAction();
  const { accounts, bad } = parseAccountList(text);
  const have = new Set(props.q.accounts.map((a) => a.username.toLowerCase()));
  const fresh = accounts.filter((a) => !have.has(a.username.toLowerCase()));
  const dup = accounts.filter((a) => have.has(a.username.toLowerCase()));
  async function save() {
    const r = await run(() => api<{ added: number; skipped: string[] }>(props.path, { accounts: fresh }));
    if (r) {
      setResult(r);
      setText("");
      props.onDone();
    }
  }
  return (
    <div class="cq-batch">
      <label class="field">
        <span>{t("粘贴账号列表，每行「编号. 用户名 密码」")}</span>
        <textarea
          rows={6}
          value={text}
          placeholder={"1. Alice cat12\n2. bob dog7"}
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          onInput={(ev) => {
            setText((ev.target as HTMLTextAreaElement).value);
            setResult(null);
          }}
        />
      </label>
      {text.trim() && (
        <div class="cq-batch-preview">
          <p>
            <strong>{t("会添加 {n} 个", { n: fresh.length })}</strong>
            {fresh.length > 0 && <span class="muted small"> {fresh.map((a) => a.username).join("、")}</span>}
          </p>
          {dup.length > 0 && (
            <p class="muted small">
              {t("已经有了，跳过 {n} 个：{names}", { n: dup.length, names: dup.map((a) => a.username).join("、") })}
            </p>
          )}
          {bad.length > 0 && (
            <div class="cq-unsure-note small">
              {t("这些行看不懂，没有添加：")}
              {bad.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {result && <p class="muted small">{t("已添加 {n} 个账号", { n: result.added })}</p>}
      {error && <p class="error">{error}</p>}
      <button type="button" class="button block" disabled={busy || fresh.length === 0} onClick={save}>
        {t("添加 {n} 个账号", { n: fresh.length })}
      </button>
    </div>
  );
}
