import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  courtLeft,
  courtPhase,
  PHOTO_MAX_SIDE,
  type PhotoCourt,
  type PhotoResult,
  QUEUE_COURT_MAX,
  QUEUE_GROUP_MAX,
  QUEUE_MAX_POSITION,
  QUEUE_SOON_MIN,
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
            {t("{n} 分钟内到时间", { n: QUEUE_SOON_MIN })}
          </span>
          <span>
            <i class="queue" />
            {t("排队")}
          </span>
          <span class="cq-tip">{t("点场可修改")}</span>
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
      {sheet?.kind === "accounts" && (
        <AccountsSheet base={props.base} e={props.e} q={q} onClose={close} onChange={props.onChange} />
      )}
    </div>
  );
}

/** One court: a block with a dashed net across it; the group's names split over the two halves. */
function CourtTile(props: {
  c: QueueCourt;
  tone: "play" | "soon" | "queue";
  line: string;
  /** While choosing courts to delete: whether this one is ticked. */
  picked?: boolean;
  onOpen: () => void;
}) {
  const choosing = props.picked !== undefined;
  const names = props.c.accounts;
  const half = (xs: string[]) => (
    <div class="cq-half">
      {xs.map((n) => (
        <span key={n}>{n}</span>
      ))}
    </div>
  );
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
    <SheetFrame title={c ? t("{n} 号场", { n: c.court }) : null} label={t("登记球场")} onClose={props.onClose}>
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
          <p class="sheet-label">{t("状态")}</p>
          <div class="seg cq-status">
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
      <p class="sheet-label">{label}</p>
      {/* Typed in the box, or dragged on the slider right beside it. */}
      <div class={noMinutes && minutes === "" ? "cq-minutes cq-unsure" : "cq-minutes"}>
        <label class="cq-minutes-box">
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
      <p class="sheet-label">{t("用了哪几个账号（1-{n} 个）", { n: QUEUE_GROUP_MAX })}</p>
      {props.q.accounts.length === 0 && (
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
      {!busy && !error && <p class="muted small">{t("拍排队屏幕，自动填好场号、时间和账号")}</p>}
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
      placeholder={t("选择或输入")}
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
}) {
  const [query, setQuery] = useState("");
  const busy = busyAccounts(props.q, props.now, props.except);
  const list = props.q.accounts
    .filter((a) => !props.picked.includes(a.username) && matches(a.username, query))
    .sort(byName);
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
              class={props.unsure?.includes(name) ? "chip on cq-pick cq-unsure" : "chip on cq-pick"}
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
  const [batch, setBatch] = useState(false);
  const { busy, error, run } = useAction();
  const path = `${props.base}/events/${props.e.id}/queue/accounts`;
  const inUse = busyAccounts(props.q, Date.now(), null);
  const shown = props.q.accounts.filter((a) => matches(a.username, query)).sort(byName);
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
      <div class="cq-add-buttons">
        <button type="button" class="button" disabled={busy || !username.trim()} onClick={add}>
          {t("添加")}
        </button>
        <button type="button" class="button secondary" aria-expanded={batch} onClick={() => setBatch(!batch)}>
          {t("批量添加")}
        </button>
      </div>
      {batch && <BatchAdd path={`${path}/batch`} q={props.q} onDone={props.onChange} />}
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
      {props.q.manage && props.q.accounts.length > 0 && (
        <button type="button" class="button danger cq-clear" disabled={busy} onClick={clear}>
          {t("清空全部账号")}
        </button>
      )}
    </SheetFrame>
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
