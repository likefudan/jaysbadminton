import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  addCourt,
  type CourtMapItem,
  type CourtMapLayout,
  type CourtMapOld,
  courtNumber,
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

/** The 球场图 button shows when the venue has a plan, or when the viewer can make one. */
export const showsCourtMap = (q: QueueInfo) => q.map !== null || q.mapEdit;

/** The legend below the plan, in the plan's own frame so it turns with it. */
const LEGEND_H = 30;

/** 编辑: which box is picked, and where a drag puts it (already on the courts' lines). */
interface Editing {
  picked: number | null;
  onPick: (i: number | null) => void;
  onMove: (i: number, x: number, y: number) => void;
}

/**
 * The plan, as large as the space allows. On a phone held upright a wide plan is turned a quarter
 * so it fills the screen; turning the phone sideways then reads it (Ke Li: 横屏显示更清晰). When the
 * screen itself is wide (phone sideways, computer), it is drawn as is. While it is being edited it
 * is never turned, so a drag goes where the finger does.
 */
function Plan(props: { layout: CourtMapLayout; tones?: Map<number, Tone>; legend?: boolean; edit?: Editing }) {
  const stage = useRef<HTMLDivElement>(null);
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
  if (size && size.w > 0 && size.h > 0) {
    const turn = !edit && aspect > 1.05 && size.h > size.w * 1.05;
    const room = { w: turn ? size.h : size.w, h: (turn ? size.w : size.h) - (props.legend ? LEGEND_H : 0) };
    const w = Math.max(0, Math.min(room.w, room.h * aspect));
    const h = w / aspect;
    // Sized to the box; a label that would be too small to read is left off (the box still shows).
    const font = (it: CourtMapItem) => {
      const size = Math.min(
        it.h * h * (it.kind === "court" ? 0.62 : 0.5),
        (it.w * w * 0.9) / Math.max(2, [...it.label].length * 0.68),
      );
      return it.kind === "court" ? Math.max(7, size) : size >= 7 ? size : null;
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
  return (
    <div
      class={edit ? "cm-stage editing" : "cm-stage"}
      style={edit ? { aspectRatio: String(aspect) } : undefined}
      ref={stage}
    >
      {sheet}
    </div>
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
        {props.busy ? t("识别中…") : props.again ? t("📷 重拍") : t("📷 拍场馆的球场图")}
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
        <button type="button" class="button secondary cm-add" onClick={add}>
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
 * 球场图 (Ke Li 2026-11-15): the venue's floor plan with our courts coloured as on the card. One
 * plan per venue (its address). The Owner, admins and organizers add one by photographing the plan
 * posted at the venue (the model draws it), put it right in 编辑, and change or remove it later.
 */
export function CourtMap(props: {
  base: string;
  e: MyEvent;
  q: QueueInfo;
  now: number;
  onClose: () => void;
  onChange: () => void;
}) {
  const path = `${props.base}/events/${props.e.id}/queue/map`;
  const [draft, setDraft] = useState<CourtMapLayout | null>(null);
  const [problem, setProblem] = useState("");
  // 以前的图: null until asked for.
  const [old, setOld] = useState<CourtMapOld[] | null>(null);
  const { busy, error, run } = useAction();
  const q = props.q;
  const venue = props.e.location;

  async function read(file: File) {
    await run(async () => {
      let image: string;
      try {
        image = await shrinkPhoto(file);
      } catch {
        throw new Error(t("这张照片打不开，请重新拍一张"));
      }
      setOld(null);
      setDraft(await api<CourtMapLayout>(`${path}/photo`, { image }));
      setProblem("");
    });
  }

  async function save() {
    const bad = draft && numbersProblem(draft);
    setProblem(bad || "");
    if (bad) return;
    await run(async () => {
      await api(path, { layout: draft });
      setDraft(null);
      props.onChange();
    });
  }

  async function remove() {
    if (!confirm(t("删掉「{venue}」的球场图？以后在这里的活动都不再显示。", { venue }))) return;
    await run(async () => {
      await api(`${path}/remove`, {});
      props.onChange();
    });
  }

  async function history() {
    await run(async () => setOld((await api<{ history: CourtMapOld[] }>(`${path}/history`, {})).history));
  }
  const when = (iso: string) => {
    const p = toPacific(iso);
    return `${p.date.slice(5).replace("-", "/")} ${p.time}`;
  };
  const historyButton = (
    <button type="button" class="button secondary" disabled={busy} onClick={history}>
      {t("以前的图")}
    </button>
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
              <button
                type="button"
                class="button secondary"
                onClick={() => {
                  setDraft(o.layout);
                  setOld(null);
                }}
              >
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
  } else if (q.map) {
    body = (
      <>
        <Plan layout={q.map} tones={courtTones(q.courts, props.now)} legend />
        {q.mapEdit && (
          <div class="cm-actions cm-manage">
            {q.photo && <PhotoInputs busy={busy} onPick={read} again />}
            <div class="cm-actions row">
              <button type="button" class="button secondary" disabled={busy} onClick={() => setDraft(q.map)}>
                {t("修改")}
              </button>
              {historyButton}
              <button type="button" class="button secondary danger" disabled={busy} onClick={remove}>
                {t("删除")}
              </button>
            </div>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <div class="cm-empty">
        <p>{t("「{venue}」还没有球场图。", { venue })}</p>
        {q.mapEdit && (
          <>
            {q.photo && (
              <>
                <p class="muted small">
                  {t("拍一张场馆贴的球场平面图，会自动画出来，可以再改编号和位置。照片不会保存。")}
                </p>
                <PhotoInputs busy={busy} onPick={read} />
              </>
            )}
            <button type="button" class="button secondary" disabled={busy} onClick={() => setDraft(BLANK)}>
              {t("不拍照，手动画")}
            </button>
            {historyButton}
          </>
        )}
      </div>
    );
  }

  return (
    <Panel title={draft ? t("编辑球场图") : t("球场图")} label={t("球场图")} class="cm-panel" onClose={props.onClose}>
      {props.e.address && !draft && <p class="muted small cm-where">{props.e.address}</p>}
      {body}
      {error && <p class="error">{error}</p>}
    </Panel>
  );
}
