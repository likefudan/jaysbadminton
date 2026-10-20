import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { eventCardText, type CardText } from "../shared/shareCard";
import type { EventSummary } from "../shared/types";
import { CalendarButton, canAddToCalendar } from "./Calendar";
import { useSiteTitle } from "./site";
import { currentLang, fmtDate, t } from "./i18n";

const W = 1080;
const H = 1560;
const SC = `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"`;
const TC = `"PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC"`;
/** Traditional Chinese cards take the TC fonts first, so 掃碼報名 isn't drawn with Simplified glyph shapes. */
const sans = () => `-apple-system, ${currentLang() === "zh-TW" ? `${TC}, ${SC}` : `${SC}, ${TC}`}, sans-serif`;
const MONO = `"Geist Mono Variable", ui-monospace, Menlo, monospace`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Cuts text to fit maxWidth, ending in "…". */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws the 分享名片 as a PNG data URL: the logo and site title on the brand gradient, then a
 * white panel with the QR code and the link. The logo is the site's own /icon.svg, so a new logo
 * shows up here without touching this code.
 */
export async function drawShareCard(siteTitle: string, text: CardText): Promise<string> {
  const SANS = sans();
  const [QRCode, logo] = await Promise.all([import("qrcode"), loadImage("/icon.svg")]);
  // Level H survives the logo covering the middle.
  const qr = QRCode.create(text.url, { errorCorrectionLevel: "H" }).modules;
  await document.fonts?.ready;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#e29a7b");
  bg.addColorStop(1, "#bf6f52");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // The logo and words sit centred above the panel, which starts no higher than PANEL_TOP.
  const PANEL_TOP = 760;
  const wordsBottom = 470 + (text.heading ? 82 : 0) + 60 * text.lines.length;
  const shift = Math.max(0, (PANEL_TOP - 60 - wordsBottom) / 2);
  ctx.translate(0, shift);

  // Logo, lifted off the matching background by a white frame and a soft shadow.
  const L = 260;
  const lx = (W - L) / 2;
  const ly = 90;
  ctx.save();
  ctx.shadowColor = "rgba(80, 30, 10, 0.35)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#fff";
  roundRect(ctx, lx - 10, ly - 10, L + 20, L + 20, 66);
  ctx.fill();
  ctx.restore();
  ctx.drawImage(logo, lx, ly, L, L);

  ctx.fillStyle = "#fff";
  ctx.font = `700 76px ${SANS}`;
  ctx.fillText(fit(ctx, siteTitle, W - 140), W / 2, 470);

  let y = 470;
  if (text.heading) {
    ctx.font = `600 50px ${SANS}`;
    y += 82;
    ctx.fillText(fit(ctx, text.heading, W - 140), W / 2, y);
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = `400 38px ${SANS}`;
  for (const line of text.lines) {
    y += 60;
    ctx.fillText(fit(ctx, line, W - 140), W / 2, y);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // White panel: QR code, hint and link.
  const px = 70;
  const pw = W - px * 2;
  const pTop = Math.max(y + 60, PANEL_TOP);
  const pBottom = H - 70;
  ctx.save();
  ctx.shadowColor = "rgba(80, 30, 10, 0.25)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#fff";
  roundRect(ctx, px, pTop, pw, pBottom - pTop, 44);
  ctx.fill();
  ctx.restore();

  const Q = Math.min(500, pBottom - pTop - 230);
  const qy = pTop + 50;
  drawQr(ctx, qr, logo, (W - Q) / 2, qy, Q);

  ctx.fillStyle = "#222";
  ctx.font = `600 42px ${SANS}`;
  ctx.fillText(text.hint, W / 2, qy + Q + 80);
  ctx.fillStyle = "#bf6f52";
  ctx.font = `500 34px ${MONO}`;
  ctx.fillText(fit(ctx, text.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), pw - 80), W / 2, qy + Q + 140);

  return canvas.toDataURL("image/png");
}

/**
 * The QR code in the card's style: round dots shading outward from a deep brown centre to the
 * brand coral, rounded finder eyes, and the logo in the middle. Every colour stays dark enough on
 * white for phone cameras.
 */
function drawQr(
  ctx: CanvasRenderingContext2D,
  m: { size: number; get(row: number, col: number): number },
  logo: HTMLImageElement,
  x: number,
  y: number,
  size: number,
) {
  const n = m.size;
  const cell = size / n;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const ink = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.72);
  ink.addColorStop(0, "#5a2214");
  ink.addColorStop(0.55, "#7e3a24");
  ink.addColorStop(1, "#9c4a2c");
  ctx.fillStyle = ink;

  const inEye = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const hole = Math.ceil(n * 0.24) | 1; // odd, so it centres on a module
  const h0 = (n - hole) / 2;
  const inHole = (r: number, c: number) => r >= h0 && r < h0 + hole && c >= h0 && c < h0 + hole;

  const dark = (r: number, c: number) => !!m.get(r, c) && !inEye(r, c) && !inHole(r, c);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!dark(r, c)) continue;
      const mx = x + (c + 0.5) * cell;
      const my = y + (r + 0.5) * cell;
      // Round dots, a little larger toward the centre: the radial look. Each dot slightly
      // overlaps its neighbours so runs stay solid, which is what phone scanners need.
      const d = Math.hypot(mx - cx, my - cy) / (size / 2);
      const radius = cell * (0.6 - 0.08 * Math.min(1, d));
      ctx.beginPath();
      ctx.arc(mx, my, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const [r, c] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ] as const) {
    const ex = x + c * cell;
    const ey = y + r * cell;
    roundRect(ctx, ex, ey, 7 * cell, 7 * cell, 2.2 * cell);
    ctx.fill();
    ctx.fillStyle = "#fff";
    roundRect(ctx, ex + cell, ey + cell, 5 * cell, 5 * cell, 1.5 * cell);
    ctx.fill();
    ctx.fillStyle = ink;
    roundRect(ctx, ex + 2 * cell, ey + 2 * cell, 3 * cell, 3 * cell, 1 * cell);
    ctx.fill();
  }

  const L = (hole - 1) * cell;
  const lx = cx - L / 2;
  const ly = cy - L / 2;
  ctx.save();
  ctx.fillStyle = "#fff";
  roundRect(ctx, lx - cell * 0.4, ly - cell * 0.4, L + cell * 0.8, L + cell * 0.8, L * 0.26);
  ctx.fill();
  roundRect(ctx, lx, ly, L, L, L * 0.22);
  ctx.clip();
  ctx.drawImage(logo, lx, ly, L, L);
  ctx.restore();
}

/** A button that opens the 分享名片: an image to long-press and save, or download. */
export function ShareCardButton(props: { text: CardText; filename: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class="share-site" type="button" onClick={() => setOpen(true)}>
        {t("生成分享名片")}
      </button>
      {open && <ShareCardSheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The action row inside a public event card: 加入日历 (a menu of Apple 日历 / Outlook and Google 日历)
 * and 分享名片, side by side with no row title. 加入日历 only while the event is still ahead; 分享名片
 * only while sign-up is open (报名中): a closed, cancelled or billed event has nobody left to invite.
 * Cards with a coloured top put both in the corner instead: {@link CardCornerIcons}.
 */
export function EventActions(props: { e: EventSummary }) {
  const e = props.e;
  const [open, setOpen] = useState(false);
  const calendar = canAddToCalendar(e);
  const share = e.status === "open";
  if (!calendar && !share) return null;
  return (
    <div class="calendar">
      {calendar && <CalendarButton e={e} />}
      {share && (
        <button class="calendar-link" type="button" onClick={() => setOpen(true)}>
          {t("分享名片")}
        </button>
      )}
      {open && <EventShareSheet e={e} onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * The top right corner of an event card with a coloured top: 加入日历 as a calendar icon (when
 * `calendar` allows and the event is still ahead), then 分享名片 as the share icon.
 */
export function CardCornerIcons(props: { e: EventSummary; calendar: boolean }) {
  const calendar = props.calendar && canAddToCalendar(props.e);
  if (!calendar && props.e.status !== "open") return null;
  return (
    <span class="corner-icons">
      {calendar && <CalendarButton e={props.e} icon />}
      <ShareIconButton e={props.e} />
    </span>
  );
}

/** 分享名片 as the iOS share icon (a box with an arrow up), in the top corner of an open event's card. */
export function ShareIconButton(props: { e: EventSummary }) {
  const [open, setOpen] = useState(false);
  if (props.e.status !== "open") return null;
  return (
    <>
      <button
        class="share-icon"
        type="button"
        aria-label={t("分享名片")}
        title={t("分享名片")}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path d="M8.5 9.5H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1.5" />
          <path d="M12 15V3" />
          <path d="M8.5 6.5 12 3l3.5 3.5" />
        </svg>
      </button>
      {open && <EventShareSheet e={props.e} onClose={() => setOpen(false)} />}
    </>
  );
}

function EventShareSheet(props: { e: EventSummary; onClose: () => void }) {
  const e = props.e;
  return (
    <ShareCardSheet
      text={eventCardText(location.origin, e, t, (d) => fmtDate(d, false))}
      filename={`event-${e.code}.png`}
      onClose={props.onClose}
    />
  );
}

function ShareCardSheet(props: { text: CardText; filename: string; onClose: () => void }) {
  const site = useSiteTitle();
  const [png, setPng] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    drawShareCard(site, props.text).then(setPng, () => setFailed(true));
  }, [site, props.text.url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // Rendered into <body>: event cards use backdrop-filter, which would otherwise trap this fixed
  // sheet inside the card instead of covering the screen.
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside is a mouse shortcut; Esc and ✕ close it too
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-label={t("分享名片")}>
        <div class="sheet-head">
          <strong>{t("分享名片")}</strong>
          <button type="button" class="sheet-close" aria-label={t("关闭")} onClick={props.onClose}>
            ✕
          </button>
        </div>
        {failed && <p class="muted">{t("名片生成失败，请刷新后再试。")}</p>}
        {!failed && !png && <p class="muted">{t("正在生成…")}</p>}
        {png && (
          <>
            <img class="sharecard" src={png} alt={t("分享名片")} />
            <p class="muted small center">{t("手机上长按图片即可保存或转发")}</p>
            <a class="button block" href={png} download={props.filename}>
              {t("下载图片")}
            </a>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
