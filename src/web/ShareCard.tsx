import { useEffect, useState } from "preact/hooks";
import { eventCardText, type CardText } from "../shared/shareCard";
import type { EventSummary } from "../shared/types";
import { useSiteTitle } from "./site";

const W = 1080;
const H = 1560;
const SANS = `-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`;
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
  const [QRCode, logo] = await Promise.all([import("qrcode"), loadImage("/icon.svg")]);
  const qr = await loadImage(await QRCode.toDataURL(text.url, { width: 520, margin: 0, errorCorrectionLevel: "M" }));
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
  ctx.drawImage(qr, (W - Q) / 2, qy, Q, Q);

  ctx.fillStyle = "#222";
  ctx.font = `600 42px ${SANS}`;
  ctx.fillText(text.hint, W / 2, qy + Q + 80);
  ctx.fillStyle = "#bf6f52";
  ctx.font = `500 34px ${MONO}`;
  ctx.fillText(fit(ctx, text.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), pw - 80), W / 2, qy + Q + 140);

  return canvas.toDataURL("image/png");
}

/** A button that opens the 分享名片: an image to long-press and save, or download. */
export function ShareCardButton(props: { text: CardText; filename: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class="button secondary block" type="button" onClick={() => setOpen(true)}>
        生成分享名片
      </button>
      {open && <ShareCardSheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * 分享活动: a row inside every event card, public or the member's own, opening the same 名片.
 * Not on events already billed (结算中 / 已结清): nobody needs to be invited to those.
 */
export function EventShareRow(props: { e: EventSummary }) {
  const [open, setOpen] = useState(false);
  if (props.e.status === "finalized" || props.e.status === "settled") return null;
  return (
    <div class="calendar share-row">
      <span class="calendar-label">分享活动</span>
      <button class="calendar-link" type="button" onClick={() => setOpen(true)}>
        生成活动名片
      </button>
      {open && (
        <ShareCardSheet
          text={eventCardText(location.origin, props.e)}
          filename={`event-${props.e.code}.png`}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
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

  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-label="分享名片">
        <div class="sheet-head">
          <strong>分享名片</strong>
          <button class="sheet-close" aria-label="关闭" onClick={props.onClose}>
            ✕
          </button>
        </div>
        {failed && <p class="muted">名片生成失败，请刷新后再试。</p>}
        {!failed && !png && <p class="muted">正在生成…</p>}
        {png && (
          <>
            <img class="sharecard" src={png} alt="分享名片" />
            <p class="muted small center">手机上长按图片即可保存或转发</p>
            <a class="button block" href={png} download={props.filename}>
              下载图片
            </a>
          </>
        )}
      </div>
    </div>
  );
}
