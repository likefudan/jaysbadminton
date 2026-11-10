import { useEffect, useRef, useState } from "preact/hooks";
import type { MeResponse } from "../shared/types";
import { api } from "./api";
import { useAction } from "./components";
import { t } from "./i18n";

/**
 * 头像 (Ke Li 2026-11-10): a member's own photo, else their Google account's picture, else an empty
 * face. Shown on the 排行榜, in 最常一起打球 and on 个人信息.
 */
export function Avatar(props: { src?: string | null; size: number; class?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = props.src && failed !== props.src ? props.src : null;
  return (
    <span
      class={`avatar${props.class ? ` ${props.class}` : ""}`}
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" loading="lazy" referrerpolicy="no-referrer" onError={() => setFailed(src)} />
      ) : (
        <EmptyFace />
      )}
    </span>
  );
}

const EmptyFace = () => (
  <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">
    <circle cx="20" cy="15.5" r="7" />
    <path d="M6.5 35c1.8-7 7-10.5 13.5-10.5S31.7 28 33.5 35z" />
  </svg>
);

/** The photo saved: a square this many pixels a side (sharp at the largest size shown, on 3× screens). */
export const AVATAR_SIDE = 256;
const QUALITY = 0.85;
/** The cropping square on screen, in CSS pixels. */
const VIEW = 260;
const MAX_ZOOM = 4;

/** 设置 → 头像 (and a tap on the avatar on 个人信息): upload a photo, back to Google's, or none. */
export function AvatarForm(props: { base: string; me: MeResponse; onDone: () => void }) {
  const { me } = props;
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  const { busy, error, run, setError } = useAction();
  async function pick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // the same photo can be picked again
    if (!file) return;
    try {
      setPhoto(await createImageBitmap(file, { imageOrientation: "from-image" }));
    } catch {
      setError(t("这张照片打不开，请换一张"));
    }
  }
  async function save(image: string) {
    if (await run(() => api(`${props.base}/avatar`, { image }))) {
      photo?.close();
      setPhoto(null);
      props.onDone();
    }
  }
  async function mode(m: "google" | "none") {
    if (await run(() => api(`${props.base}/avatar/mode`, { mode: m }))) props.onDone();
  }
  if (photo)
    return (
      <Cropper
        photo={photo}
        busy={busy}
        error={error}
        onSave={save}
        onCancel={() => {
          photo.close();
          setPhoto(null);
        }}
      />
    );
  return (
    <div class="avatar-form">
      <Avatar src={me.avatar} size={88} class="avatar-big" />
      <p class="muted small">
        {me.avatarMode === "own"
          ? t("用的是你上传的照片。")
          : me.avatarMode === "none"
            ? t("现在不显示头像。")
            : me.googlePicture
              ? t("现在用的是 Google 账号的头像。")
              : t("还没有头像。")}{" "}
        {t("头像会显示在排行榜和「最常一起打球」里，只有群里的成员看得到。")}
      </p>
      {error && <p class="error">{error}</p>}
      <div class="inline avatar-actions">
        <label class={`button${busy ? " disabled" : ""}`}>
          {me.avatarMode === "own" ? t("换一张照片") : t("上传照片")}
          <input type="file" accept="image/*" hidden disabled={busy} onChange={pick} />
        </label>
        {me.googlePicture && me.avatarMode !== "google" && (
          <button type="button" class="button secondary" disabled={busy} onClick={() => mode("google")}>
            {t("用 Google 头像")}
          </button>
        )}
        {me.avatarMode !== "none" && (me.avatarMode === "own" || me.googlePicture) && (
          <button type="button" class="button secondary" disabled={busy} onClick={() => mode("none")}>
            {t("不用头像")}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Move and zoom the photo inside the circle (drag, pinch, or the slider), then 保存: the square
 * behind the circle is drawn at AVATAR_SIDE and sent as JPEG, about 10-20 KB.
 */
function Cropper(props: {
  photo: ImageBitmap;
  busy: boolean;
  error: string;
  onSave: (base64: string) => void;
  onCancel: () => void;
}) {
  const { photo } = props;
  const fit = VIEW / Math.min(photo.width, photo.height);
  // The photo's top-left corner in the square, and its scale (screen px per photo px).
  const [view, setView] = useState(() => ({
    scale: fit,
    x: (VIEW - photo.width * fit) / 2,
    y: (VIEW - photo.height * fit) / 2,
  }));
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  /** Keeps the square covered: no empty edge shows. */
  const clamp = (v: { scale: number; x: number; y: number }) => {
    const scale = Math.min(Math.max(v.scale, fit), fit * MAX_ZOOM);
    const w = photo.width * scale,
      h = photo.height * scale;
    return { scale, x: Math.min(0, Math.max(VIEW - w, v.x)), y: Math.min(0, Math.max(VIEW - h, v.y)) };
  };
  /** Zoom around a point of the square (its centre for the slider). */
  const zoomTo = (scale: number, cx = VIEW / 2, cy = VIEW / 2) =>
    setView((v) => {
      const k = Math.min(Math.max(scale, fit), fit * MAX_ZOOM) / v.scale;
      return clamp({ scale: v.scale * k, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
    });

  useEffect(() => {
    const c = canvas.current!;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = VIEW * dpr;
    c.height = VIEW * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, VIEW, VIEW);
    g.imageSmoothingQuality = "high";
    g.drawImage(photo, view.x, view.y, photo.width * view.scale, photo.height * view.scale);
  }, [photo, view]);

  const local = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * VIEW) / r.width, y: ((e.clientY - r.top) * VIEW) / r.height };
  };
  function down(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  }
  function move(e: PointerEvent) {
    const p = pointers.current;
    const before = p.get(e.pointerId);
    if (!before) return;
    const now = local(e);
    if (p.size === 1) {
      setView((v) => clamp({ ...v, x: v.x + now.x - before.x, y: v.y + now.y - before.y }));
    } else if (p.size === 2) {
      const other = [...p.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(before.x - other.x, before.y - other.y);
      const d1 = Math.hypot(now.x - other.x, now.y - other.y);
      if (d0 > 0) zoomTo(view.scale * (d1 / d0), (now.x + other.x) / 2, (now.y + other.y) / 2);
    }
    p.set(e.pointerId, now);
  }
  const up = (e: PointerEvent) => pointers.current.delete(e.pointerId);

  function save() {
    const out = document.createElement("canvas");
    out.width = AVATAR_SIDE;
    out.height = AVATAR_SIDE;
    const g = out.getContext("2d")!;
    // JPEG has no transparency: a see-through PNG gets white behind it, not black.
    g.fillStyle = "#fff";
    g.fillRect(0, 0, AVATAR_SIDE, AVATAR_SIDE);
    g.imageSmoothingQuality = "high";
    const side = VIEW / view.scale;
    g.drawImage(photo, -view.x / view.scale, -view.y / view.scale, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
    const url = out.toDataURL("image/jpeg", QUALITY);
    props.onSave(url.slice(url.indexOf(",") + 1));
  }

  return (
    <div class="avatar-crop">
      <p class="muted small">{t("拖动、双指缩放，把脸放进圆圈里。")}</p>
      <div class="crop-frame" style={{ width: `${VIEW}px`, height: `${VIEW}px` }}>
        <canvas
          ref={canvas}
          style={{ width: `${VIEW}px`, height: `${VIEW}px` }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={(e) => {
            e.preventDefault();
            const p = local(e as unknown as PointerEvent);
            zoomTo(view.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), p.x, p.y);
          }}
        />
        <span class="crop-ring" aria-hidden="true" />
      </div>
      <input
        type="range"
        class="crop-zoom"
        aria-label={t("缩放")}
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={view.scale / fit}
        onInput={(e) => zoomTo(fit * Number((e.target as HTMLInputElement).value))}
      />
      {props.error && <p class="error">{props.error}</p>}
      <div class="inline">
        <button type="button" class="button" disabled={props.busy} onClick={save}>
          {props.busy ? t("保存中…") : t("保存")}
        </button>
        <button type="button" class="button secondary" disabled={props.busy} onClick={props.onCancel}>
          {t("取消")}
        </button>
      </div>
    </div>
  );
}
