import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  addCourt,
  type CourtMapItem,
  type CourtMapLayout,
  type CourtMapOld,
  type CourtMapRect,
  type CourtMapVenue,
  courtNumber,
  cropLayout,
  moveStep,
  snapMove,
} from "../shared/courtMap";
import { courtPhase, type QueueCourt, type QueueInfo, QUEUE_SOON_MIN } from "../shared/courtQueue";
import { toPacific } from "../shared/time";
import type { MyEvent } from "../shared/types";
import { api } from "./api";
import { useAction } from "./components";
import { t } from "./i18n";
import { Panel } from "./Panel";
import { shrinkPhoto } from "./photo";

type Tone = "play" | "soon" | "queue";

/** Our state per court number: playing wins over a group still waiting for the same court. */
export function courtTones(courts: QueueCourt[], now: number): Map<number, Tone> {
  const tones = new Map<number, Tone>();
  for (const c of courts) {
    const p = courtPhase(c, now);
    if (p.phase === "playing") tones.set(c.court, p.minutes <= QUEUE_SOON_MIN ? "soon" : "play");
    else if (p.phase === "queued" && !tones.has(c.court)) tones.set(c.court, "queue");
  }
  return tones;
}

/** The card's 球场图 button shows only when the venue has a plan (they are made in 设置). */
export const showsCourtMap = (q: QueueInfo) => q.map !== null;

/** The legend below the plan, in the plan's own frame so it turns with it. */
const LEGEND_H = 30;

/** 编辑: which box is picked, and where a drag puts it (already on the courts' lines). */
interface Editing {
  picked: number | null;
  onPick: (i: number | null) => void;
  onMove: (i: number, x: number, y: number) => void;
  /** 裁剪: the range being dragged out over the plan (null until one is), when cropping. */
  crop?: { rect: CourtMapRect | null; onRect: (r: CourtMapRect) => void };
}

/**
 * Which way up each person likes the plan (Ke Li 2026-11-15: 记忆每个用户的preference): kept on
 * their phone once they press 旋转; until then a wide plan turns itself on an upright phone.
 */
const TURN_KEY = "court-map-turned";
function savedTurn(): boolean | null {
  try {
    const v = localStorage.getItem(TURN_KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}
function saveTurn(turned: boolean) {
  try {
    localStorage.setItem(TURN_KEY, turned ? "1" : "0");
  } catch {}
}

const TurnIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </svg>
);

/**
 * The plan, as large as the space allows, either way up (Ke Li 2026-11-15: 横竖屏都能显示): as
 * drawn, or turned a quarter. 旋转 above it switches between the two and the choice is remembered.
 * Before anyone chooses, a wide plan on a phone held upright is turned so it fills the screen, and
 * on a wide screen (phone sideways, computer) it is drawn as is. While it is being edited it is
 * never turned, so a drag goes where the finger does.
 */
function Plan(props: {
  layout: CourtMapLayout;
  tones?: Map<number, Tone>;
  legend?: boolean;
  edit?: Editing;
  /** The venue's address, beside 旋转. */
  caption?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [turned, setTurned] = useState(savedTurn);
  const range = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ i: number; px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = stage.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { aspect, items } = props.layout;
  const edit = props.edit;
  let sheet = null;
  // Which way it is drawn now, for 旋转 to switch from.
  let turn = false;
  if (size && size.w > 0 && size.h > 0) {
    turn = !edit && (turned ?? (aspect > 1.05 && size.h > size.w * 1.05));
    const room = { w: turn ? size.h : size.w, h: (turn ? size.w : size.h) - (props.legend ? LEGEND_H : 0) };
    const w = Math.max(0, Math.min(room.w, room.h * aspect));
    const h = w / aspect;
    // Sized to the box. Numbers and labels are always drawn (Ke Li 2026-11-15: labels were left
    // off); only another box's name too small to read is left off, and its box still shows.
    const font = (it: CourtMapItem) => {
      const size = Math.min(
        it.h * h * (it.kind === "court" ? 0.62 : it.kind === "text" ? 0.9 : 0.5),
        (it.w * w * 0.9) / Math.max(2, [...it.label].length * 0.68),
      );
      if (it.kind === "court") return Math.max(7, size);
      if (it.kind === "text") return Math.min(13, Math.max(8, size));
      return size >= 6 ? size : null;
    };
    const down = (i: number, it: CourtMapItem) => (ev: PointerEvent) => {
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      drag.current = { i, px: ev.clientX, py: ev.clientY, x: it.x, y: it.y, moved: false };
      edit!.onPick(i);
    };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.px;
      const dy = ev.clientY - d.py;
      // A few pixels of wobble is still a tap.
      if (!d.moved && Math.hypot(dx, dy) < 6) return;
      d.moved = true;
      edit!.onMove(d.i, d.x + dx / w, d.y + dy / h);
    };
    const up = () => {
      drag.current = null;
    };
    // 裁剪: a drag across the plan is the range to keep, from where it began to where it is now.
    const crop = edit?.crop;
    const at = (ev: PointerEvent) => {
      const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const frac = (v: number) => Math.min(1, Math.max(0, v));
      return { x: frac((ev.clientX - box.left) / box.width), y: frac((ev.clientY - box.top) / box.height) };
    };
    const rangeDown = (ev: PointerEvent) => {
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      range.current = at(ev);
    };
    const rangeMove = (ev: PointerEvent) => {
      const from = range.current;
      if (!from) return;
      const to = at(ev);
      crop!.onRect({
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        w: Math.abs(to.x - from.x),
        h: Math.abs(to.y - from.y),
      });
    };
    const rangeUp = () => {
      range.current = null;
    };
    sheet = (
      <div
        class={`cm-sheet${turn ? " turned" : ""}`}
        style={{ width: `${w}px`, height: `${h + (props.legend ? LEGEND_H : 0)}px` }}
      >
        <ul class={edit ? "cm-plan editing" : "cm-plan"} style={{ height: `${h}px` }}>
          {items.map((it, i) => {
            const n = it.kind === "court" ? courtNumber(it.label) : null;
            const tone = n !== null ? props.tones?.get(n) : undefined;
            const size = font(it);
            const box = {
              left: `${it.x * 100}%`,
              top: `${it.y * 100}%`,
              width: `${it.w * 100}%`,
              height: `${it.h * 100}%`,
              fontSize: size ? `${size}px` : undefined,
            };
            const cls = `cm-item ${it.kind}${tone ? ` ${tone}` : ""}${edit?.picked === i ? " picked" : ""}`;
            return (
              <li key={i} class={cls} style={box}>
                {edit ? (
                  <button
                    type="button"
                    aria-pressed={edit.picked === i}
                    aria-label={it.label || t("没有名字的方块")}
                    onClick={() => edit.onPick(i)}
                    onPointerDown={down(i, it)}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                  >
                    {size ? it.label : ""}
                  </button>
                ) : (
                  size && <span>{it.label}</span>
                )}
              </li>
            );
          })}
        </ul>
        {crop && (
          <div
            class="cm-crop"
            style={{ height: `${h}px` }}
            onPointerDown={rangeDown}
            onPointerMove={rangeMove}
            onPointerUp={rangeUp}
            onPointerCancel={rangeUp}
          >
            {crop.rect && (
              <i
                style={{
                  left: `${crop.rect.x * 100}%`,
                  top: `${crop.rect.y * 100}%`,
                  width: `${crop.rect.w * 100}%`,
                  height: `${crop.rect.h * 100}%`,
                }}
              />
            )}
          </div>
        )}
        {props.legend && (
          <ul class="cm-key">
            <li>
              <i class="play" />
              {t("在打")}
            </li>
            <li>
              <i class="soon" />
              {t("{n} 分钟内", { n: QUEUE_SOON_MIN })}
            </li>
            <li>
              <i class="queue" />
              {t("排队")}
            </li>
            <li>
              <i />
              {t("其他场地")}
            </li>
          </ul>
        )}
      </div>
    );
  }
  const stageEl = (
    <div
      class={edit ? "cm-stage editing" : "cm-stage"}
      style={edit ? { aspectRatio: String(aspect) } : undefined}
      ref={stage}
    >
      {sheet}
    </div>
  );
  if (edit) return stageEl;
  return (
    <>
      <div class="cm-bar">
        <span class="muted small">{props.caption}</span>
        <button
          type="button"
          class="button secondary cm-turn"
          onClick={() => {
            saveTurn(!turn);
            setTurned(!turn);
          }}
        >
          <TurnIcon />
          {t("旋转")}
        </button>
      </div>
      {stageEl}
    </>
  );
}

/** 拍照: the camera, or 相册 for a photo already taken (Android shows no camera for a plain input). */
function PhotoInputs(props: { busy: boolean; onPick: (file: File) => void; again?: boolean }) {
  function pick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) props.onPick(file);
  }
  return (
    <div class="cq-photo-row">
      <label class={`button secondary cq-photo-button cq-photo-camera${props.busy ? " disabled" : ""}`}>
        <input type="file" accept="image/*" capture="environment" disabled={props.busy} onChange={pick} />
        {props.busy ? t("上传中…") : props.again ? t("📷 重拍") : t("📷 拍场馆的球场图")}
      </label>
      <label class={`button secondary cq-photo-button cq-photo-album${props.busy ? " disabled" : ""}`}>
        <input type="file" accept="image/*" disabled={props.busy} onChange={pick} />
        {t("相册")}
      </label>
    </div>
  );
}

/** What stops a plan from being saved, or null: every court a number 1–99, none twice. */
function numbersProblem(layout: CourtMapLayout): string | null {
  const seen = new Set<number>();
  for (const it of layout.items) {
    if (it.kind !== "court") continue;
    const n = courtNumber(it.label);
    if (n === null) return t("场地编号要填 1–99 的数字，请改一下「{label}」", { label: it.label || "?" });
    if (seen.has(n)) return t("有两片场地都是 {n} 号，请改掉一个", { n });
    seen.add(n);
  }
  return seen.size ? null : t("球场图里至少要有一片场地");
}

/**
 * 编辑 (Ke Li 2026-11-15): what the model drew, or the plan kept so far, put right by hand. A tap
 * picks a box; its number is typed below; a drag or the arrows move it, always onto the courts'
 * rows and columns (snapMove), never at an angle or slightly off; courts are added and removed.
 */
function Editor(props: { layout: CourtMapLayout; onChange: (l: CourtMapLayout) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  // 裁剪: off (undefined), on with no range dragged yet (null), or the range.
  const [crop, setCrop] = useState<CourtMapRect | null | undefined>(undefined);
  const [cropProblem, setCropProblem] = useState("");
  const layout = props.layout;
  const it = picked === null ? undefined : layout.items[picked];
  const set = (i: number, part: Partial<CourtMapItem>) =>
    props.onChange({ ...layout, items: layout.items.map((x, k) => (k === i ? { ...x, ...part } : x)) });
  const move = (i: number, x: number, y: number) => set(i, snapMove(layout, i, x, y));
  function nudge(dx: number, dy: number) {
    if (picked === null || !it) return;
    const step = moveStep(layout, picked);
    move(picked, it.x + dx * step.x, it.y + dy * step.y);
  }
  function remove() {
    if (picked === null) return;
    props.onChange({ ...layout, items: layout.items.filter((_, k) => k !== picked) });
    setPicked(null);
  }
  function add() {
    const next = addCourt(layout);
    props.onChange(next);
    setPicked(next.items.length - 1);
  }
  function applyCrop() {
    if (!crop) return;
    const next = cropLayout(layout, crop);
    if (!next) return setCropProblem(t("选的范围里没有场地，请重新拖一个范围"));
    props.onChange(next);
    setCrop(undefined);
  }
  if (crop !== undefined)
    return (
      <>
        <Plan
          layout={layout}
          edit={{
            picked: null,
            onPick: () => {},
            onMove: () => {},
            crop: {
              rect: crop,
              onRect: (r) => {
                setCrop(r);
                setCropProblem("");
              },
            },
          }}
        />
        <div class="cm-tools">
          <p class="muted small">{t("在图上拖出要保留的范围。范围外的场地和文字会去掉，剩下的放大到整张图。")}</p>
          {cropProblem && <p class="error">{cropProblem}</p>}
          <button type="button" class="button" disabled={!crop || crop.w < 0.02 || crop.h < 0.02} onClick={applyCrop}>
            {t("确定裁剪")}
          </button>
          <button type="button" class="button secondary" onClick={() => setCrop(undefined)}>
            {t("返回")}
          </button>
        </div>
      </>
    );
  const arrow = (label: string, glyph: string, dx: number, dy: number) => (
    <button type="button" class="button secondary cm-arrow" aria-label={label} onClick={() => nudge(dx, dy)}>
      {glyph}
    </button>
  );
  return (
    <>
      <Plan layout={layout} edit={{ picked, onPick: setPicked, onMove: move }} />
      <div class="cm-tools">
        {it && picked !== null ? (
          <>
            <label class="cm-number">
              <span>{it.kind === "court" ? t("编号") : t("文字")}</span>
              <input
                type="text"
                inputMode={it.kind === "court" ? "numeric" : "text"}
                maxLength={it.kind === "court" ? 2 : 24}
                value={it.label}
                onInput={(ev) => {
                  const input = ev.target as HTMLInputElement;
                  // A court's number is digits only; other text is trimmed when saved, not while typed.
                  if (it.kind === "court") input.value = input.value.replace(/\D/g, "");
                  set(picked, { label: input.value });
                }}
              />
            </label>
            <div class="cm-arrows">
              {arrow(t("左移"), "←", -1, 0)}
              {arrow(t("上移"), "↑", 0, -1)}
              {arrow(t("下移"), "↓", 0, 1)}
              {arrow(t("右移"), "→", 1, 0)}
            </div>
            <button type="button" class="button secondary danger cm-remove" onClick={remove}>
              {t("删除")}
            </button>
          </>
        ) : (
          <p class="muted small">{t("点一片场地改编号、拖动或删除。场地会自动对齐到行和列。")}</p>
        )}
        <button
          type="button"
          class="button secondary cm-add"
          onClick={() => {
            setPicked(null);
            setCropProblem("");
            setCrop(null);
          }}
        >
          {t("裁剪")}
        </button>
        <button type="button" class="button secondary" onClick={add}>
          {t("＋ 添加场地")}
        </button>
      </div>
    </>
  );
}

/** A plan to start from without a photo: one court, the rest added by hand. */
const BLANK: CourtMapLayout = {
  aspect: 1.4,
  items: [{ kind: "court", label: "1", x: 0.05, y: 0.05, w: 0.12, h: 0.08 }],
};

/**
 * 球场图 on an event's card (Ke Li 2026-11-15): the venue's floor plan with our courts coloured as
 * on the card, to look at only. Plans are made and changed in 设置 → 球场图.
 */
export function CourtMap(props: { e: MyEvent; q: QueueInfo; now: number; onClose: () => void }) {
  const map = props.q.map;
  return (
    <Panel title={t("球场图")} label={t("球场图")} class="cm-panel" onClose={props.onClose}>
      {map && <Plan layout={map} tones={courtTones(props.q.courts, props.now)} legend caption={props.e.address} />}
    </Panel>
  );
}

const when = (iso: string) => {
  const p = toPacific(iso);
  return `${p.date.slice(5).replace("-", "/")} ${p.time}`;
};

/**
 * 设置 → 球场图 → one venue (Ke Li 2026-11-15: 在设置里管理): the Owner, admins and organizers add
 * its plan by photographing the one posted at the venue (the model draws it) or by hand, put it
 * right in the editor, replace or remove it, and bring back one of 以前的图.
 */
export function CourtMapManager(props: {
  base: string;
  venue: CourtMapVenue;
  /** The site has a key for the model that reads the photo. */
  photo: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const path = `${props.base}/court-maps`;
  const { venue, address, map, read: sent } = props.venue;
  const where = { venue, address };
  const [draft, setDraft] = useState<CourtMapLayout | null>(null);
  // The draft is what the venue's photo came to: saving it puts that answer away.
  const [fromRead, setFromRead] = useState(false);
  const [problem, setProblem] = useState("");
  // 以前的图: null until asked for.
  const [old, setOld] = useState<CourtMapOld[] | null>(null);
  const { busy, error, run } = useAction();

  async function read(file: File) {
    await run(async () => {
      let image: string;
      try {
        image = await shrinkPhoto(file);
      } catch {
        throw new Error(t("这张照片打不开，请重新拍一张"));
      }
      setOld(null);
      // Read in the background: the list says when it is done, here or after coming back.
      await api(`${path}/photo`, { ...where, image });
      props.onChange();
    });
  }

  async function drop() {
    await run(async () => {
      await api(`${path}/photo/drop`, where);
      props.onChange();
    });
  }
  const edit = (layout: CourtMapLayout, read = false) => {
    setDraft(layout);
    setFromRead(read);
    setOld(null);
    setProblem("");
  };

  async function save() {
    const bad = draft && numbersProblem(draft);
    setProblem(bad || "");
    if (bad) return;
    await run(async () => {
      await api(`${path}/save`, { ...where, layout: draft, read: fromRead });
      setDraft(null);
      props.onChange();
    });
  }

  async function remove() {
    if (!confirm(t("删掉「{venue}」的球场图？以后在这里的活动都不再显示。", { venue }))) return;
    await run(async () => {
      await api(`${path}/remove`, where);
      props.onChange();
    });
  }

  async function history() {
    await run(async () => setOld((await api<{ history: CourtMapOld[] }>(`${path}/history`, where)).history));
  }
  const historyButton = (
    <button type="button" class="button secondary" disabled={busy} onClick={history}>
      {t("以前的图")}
    </button>
  );

  // One photo at a time for a venue: no 拍照 while the last one is still being read.
  const canPhoto = props.photo && sent?.state !== "pending";
  const who = { name: sent?.by || "?", when: sent ? when(sent.at) : "" };
  const notice = sent && (
    <div class={`cm-read ${sent.state}`} role="status">
      {sent.state === "pending" && (
        <p>
          {t(
            "{name} {when} 拍的照片正在识别，大约要一两分钟。不用在这里等，可以先去别的页面，过一会儿回来看结果。",
            who,
          )}
        </p>
      )}
      {sent.state === "ready" && sent.layout && (
        <>
          <p>{t("{name} {when} 拍的照片识别好了，请核对后保存。", who)}</p>
          <div class="cm-actions row">
            <button type="button" class="button" disabled={busy} onClick={() => edit(sent.layout!, true)}>
              {t("查看并核对")}
            </button>
            <button type="button" class="button secondary" disabled={busy} onClick={drop}>
              {t("不要了")}
            </button>
          </div>
        </>
      )}
      {(sent.state === "none" || sent.state === "failed") && (
        <>
          <p>
            {sent.state === "none"
              ? t("{name} {when} 拍的照片上没有找到球场图，请对准场馆贴的平面图重拍一张。", who)
              : t("{name} {when} 拍的照片没有识别出来，请重拍一张。", who)}
          </p>
          <button type="button" class="button secondary" disabled={busy} onClick={drop}>
            {t("知道了")}
          </button>
        </>
      )}
    </div>
  );

  let body: ComponentChildren;
  if (old && !draft) {
    body = (
      <div class="cm-empty">
        <p class="muted small">{t("这里留着最近 30 天换掉或删掉的图，最多 10 张。点「恢复」打开，核对后保存。")}</p>
        {old.length === 0 && <p>{t("还没有以前的图。")}</p>}
        <ul class="cm-old">
          {old.map((o) => (
            <li key={o.id}>
              <span>
                <strong>{when(o.savedAt)}</strong>
                <small class="muted">
                  {t("{name} 保存 · {n} 片场地", {
                    name: o.savedBy || "?",
                    n: o.layout.items.filter((i) => i.kind === "court").length,
                  })}
                </small>
              </span>
              <button type="button" class="button secondary" onClick={() => edit(o.layout)}>
                {t("恢复")}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="button secondary" onClick={() => setOld(null)}>
          {t("返回")}
        </button>
      </div>
    );
  } else if (draft) {
    body = (
      <>
        <Editor
          layout={draft}
          onChange={(l) => {
            setDraft(l);
            setProblem("");
          }}
        />
        {problem && <p class="error">{problem}</p>}
        <div class="cm-actions row">
          <button type="button" class="button" disabled={busy} onClick={save}>
            {t("保存")}
          </button>
          <button type="button" class="button secondary" disabled={busy} onClick={() => setDraft(null)}>
            {t("取消")}
          </button>
        </div>
      </>
    );
  } else if (map) {
    body = (
      <>
        {notice}
        <Plan layout={map} caption={address} />
        <p class="muted small cm-saved">
          {t("{name} 于 {when} 保存", {
            name: props.venue.savedBy || "?",
            when: props.venue.updatedAt ? when(props.venue.updatedAt) : "",
          })}
        </p>
        <div class="cm-actions cm-manage">
          {canPhoto && <PhotoInputs busy={busy} onPick={read} again />}
          <div class="cm-actions row">
            <button type="button" class="button secondary" disabled={busy} onClick={() => edit(map)}>
              {t("修改")}
            </button>
            {historyButton}
            <button type="button" class="button secondary danger" disabled={busy} onClick={remove}>
              {t("删除")}
            </button>
          </div>
        </div>
      </>
    );
  } else {
    body = (
      <div class="cm-empty">
        <p>{t("「{venue}」还没有球场图。", { venue })}</p>
        {notice}
        {canPhoto && (
          <>
            <p class="muted small">
              {t(
                "拍一张场馆贴的球场平面图，会在后台画出来，大约一两分钟，不用在这里等。画好后可以再改编号和位置。照片不会保存。",
              )}
            </p>
            <PhotoInputs busy={busy} onPick={read} />
          </>
        )}
        <button type="button" class="button secondary" disabled={busy} onClick={() => edit(BLANK)}>
          {t("不拍照，手动画")}
        </button>
        {historyButton}
      </div>
    );
  }

  return (
    <Panel title={draft ? t("编辑球场图") : venue} label={t("球场图")} class="cm-panel" onClose={props.onClose}>
      {address && !draft && !map && <p class="muted small cm-where">{address}</p>}
      {body}
      {error && <p class="error">{error}</p>}
    </Panel>
  );
}
