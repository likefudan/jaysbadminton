import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { type CourtMapItem, type CourtMapLayout, cleanLayout, courtNumber } from "../shared/courtMap";
import { courtPhase, type QueueCourt, type QueueInfo, QUEUE_SOON_MIN } from "../shared/courtQueue";
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
export const showsCourtMap = (q: QueueInfo) => q.map !== null || (q.mapEdit && q.photo);

/** The legend below the plan, in the plan's own frame so it turns with it. */
const LEGEND_H = 30;

/**
 * The plan, as large as the space allows. On a phone held upright a wide plan is turned a quarter
 * so it fills the screen; turning the phone sideways then reads it (Ke Li: 横屏显示更清晰). When the
 * screen itself is wide (phone sideways, computer), it is drawn as is.
 */
function Plan(props: {
  layout: CourtMapLayout;
  tones?: Map<number, Tone>;
  legend?: boolean;
  onCourt?: (i: number) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = stage.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { aspect, items } = props.layout;
  let sheet = null;
  if (size && size.w > 0 && size.h > 0) {
    const turn = aspect > 1.05 && size.h > size.w * 1.05;
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
    sheet = (
      <div
        class={`cm-sheet${turn ? " turned" : ""}`}
        style={{ width: `${w}px`, height: `${h + (props.legend ? LEGEND_H : 0)}px` }}
      >
        <ul class="cm-plan" style={{ height: `${h}px` }}>
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
            const cls = `cm-item ${it.kind}${tone ? ` ${tone}` : ""}`;
            return (
              <li key={i} class={cls} style={box}>
                {props.onCourt && it.kind === "court" ? (
                  <button type="button" onClick={() => props.onCourt!(i)}>
                    {it.label}
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
    <div class="cm-stage" ref={stage}>
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

/**
 * 球场图 (Ke Li 2026-11-15): the venue's floor plan with our courts coloured as on the card. Who can
 * set it photographs the plan posted at the venue; the model reads it, they check the numbers (a
 * tap changes or removes one) and save it for the venue.
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
  const { busy, error, run } = useAction();
  const q = props.q;

  async function read(file: File) {
    await run(async () => {
      let image: string;
      try {
        image = await shrinkPhoto(file);
      } catch {
        throw new Error(t("这张照片打不开，请重新拍一张"));
      }
      setDraft(await api<CourtMapLayout>(`${path}/photo`, { image }));
    });
  }

  function edit(i: number) {
    if (!draft) return;
    const it = draft.items[i];
    if (!it) return;
    const v = prompt(t("{n} 号场改成几号？清空就删掉这片场地", { n: it.label }), it.label);
    if (v === null) return;
    const label = v.trim();
    const items =
      label === "" ? draft.items.filter((_, k) => k !== i) : draft.items.map((x, k) => (k === i ? { ...x, label } : x));
    const next = cleanLayout({ ...draft, items });
    if (next) setDraft(next);
  }

  async function save() {
    await run(async () => {
      await api(path, { layout: draft });
      setDraft(null);
      props.onChange();
    });
  }

  async function remove() {
    if (!confirm(t("删掉「{venue}」的球场图？以后在这里的活动都不再显示。", { venue: props.e.location }))) return;
    await run(async () => {
      await api(`${path}/remove`, {});
      props.onChange();
    });
  }

  let body: ComponentChildren;
  if (draft) {
    body = (
      <>
        <p class="muted small cm-note">{t("请核对场地编号：点一片场地可以改号或删掉。")}</p>
        <Plan layout={draft} onCourt={edit} />
        <div class="cm-actions">
          <button type="button" class="button" disabled={busy} onClick={save}>
            {t("保存为「{venue}」的球场图", { venue: props.e.location })}
          </button>
          <PhotoInputs busy={busy} onPick={read} again />
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
          <div class="cm-actions row">
            {q.photo && <PhotoInputs busy={busy} onPick={read} again />}
            <button type="button" class="button secondary danger" disabled={busy} onClick={remove}>
              {t("删除")}
            </button>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <div class="cm-empty">
        <p>{t("「{venue}」还没有球场图。", { venue: props.e.location })}</p>
        {q.mapEdit && q.photo && (
          <>
            <p class="muted small">{t("拍一张场馆贴的球场平面图，会自动画出来，核对后保存。照片不会保存。")}</p>
            <PhotoInputs busy={busy} onPick={read} />
          </>
        )}
      </div>
    );
  }

  return (
    <Panel title={t("球场图")} label={t("球场图")} class="cm-panel" onClose={props.onClose}>
      {body}
      {error && <p class="error">{error}</p>}
    </Panel>
  );
}
