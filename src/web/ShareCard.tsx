import { Panel } from "./Panel";
import { useEffect, useState } from "preact/hooks";
import { eventCardText, type CardText } from "../shared/shareCard";
import { shareColours } from "../shared/themes";
import type { EventSummary } from "../shared/types";
import { CalendarButton, canAddToCalendar } from "./Calendar";
import { siteThemeId, useSiteTitle } from "./site";
import { currentLang, fmtDate, t } from "./i18n";

const W = 1080;
const H = 1560;
const SC = `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"`;
const TC = `"PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC"`;
/** Traditional Chinese cards take the TC fonts first, so 掃碼報名 isn't drawn with Simplified glyph shapes. */
export const shareSans = () =>
  `-apple-system, ${currentLang() === "zh-TW" ? `${TC}, ${SC}` : `${SC}, ${TC}`}, sans-serif`;
const MONO = `"Geist Mono Variable", ui-monospace, Menlo, monospace`;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Cuts text to fit maxWidth, ending in "…". */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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
  const SANS = shareSans();
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

  const colours = shareColours(siteThemeId());
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, colours.from);
  bg.addColorStop(1, colours.to);
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
  ctx.shadowColor = "rgba(20, 20, 30, 0.3)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#fff";
  roundRect(ctx, lx - 10, ly - 10, L + 20, L + 20, 66);
  ctx.fill();
  ctx.restore();
  ctx.drawImage(logo, lx, ly, L, L);

  ctx.fillStyle = "#fff";
  ctx.font = `700 76px ${SANS}`;
  ctx.fillText(fitText(ctx, siteTitle, W - 140), W / 2, 470);

  let y = 470;
  if (text.heading) {
    ctx.font = `600 50px ${SANS}`;
    y += 82;
    ctx.fillText(fitText(ctx, text.heading, W - 140), W / 2, y);
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = `400 38px ${SANS}`;
  for (const line of text.lines) {
    y += 60;
    ctx.fillText(fitText(ctx, line, W - 140), W / 2, y);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // White panel: QR code, hint and link.
  const px = 70;
  const pw = W - px * 2;
  const pTop = Math.max(y + 60, PANEL_TOP);
  const pBottom = H - 70;
  ctx.save();
  ctx.shadowColor = "rgba(20, 20, 30, 0.2)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#fff";
  roundRect(ctx, px, pTop, pw, pBottom - pTop, 44);
  ctx.fill();
  ctx.restore();

  const Q = Math.min(500, pBottom - pTop - 230);
  const qy = pTop + 50;
  drawQr(ctx, qr, logo, (W - Q) / 2, qy, Q, colours.ink);

  ctx.fillStyle = "#222";
  ctx.font = `600 42px ${SANS}`;
  ctx.fillText(text.hint, W / 2, qy + Q + 80);
  ctx.fillStyle = colours.link;
  ctx.font = `500 34px ${MONO}`;
  ctx.fillText(fitText(ctx, text.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), pw - 80), W / 2, qy + Q + 140);

  return canvas.toDataURL("image/png");
}

/**
 * The QR code in the card's style: round dots shading outward from a dark centre to
 * the site's colour, rounded finder eyes, and the logo in the middle. Every colour stays dark enough on
 * white for phone cameras.
 */
function drawQr(
  ctx: CanvasRenderingContext2D,
  m: { size: number; get(row: number, col: number): number },
  logo: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  colours: readonly [string, string, string],
) {
  const n = m.size;
  const cell = size / n;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const ink = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.72);
  ink.addColorStop(0, colours[0]);
  ink.addColorStop(0.55, colours[1]);
  ink.addColorStop(1, colours[2]);
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

/** The iOS share icon: a box with an arrow up. */
export function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path d="M8.5 9.5H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1.5" />
      <path d="M12 15V3" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
    </svg>
  );
}

/** 分享 (the share icon and the word) that opens the 分享名片: an image to long-press and save or forward. */
export function ShareCardButton(props: { text: CardText }) {
  const [open, setOpen] = useState(false);
  const site = useSiteTitle();
  const tap = useDirectShare(
    () => drawShareCard(site, props.text),
    `${site}|${JSON.stringify(props.text)}`,
    site,
    () => setOpen(true),
  );
  return (
    <>
      <button class="share-site" type="button" onClick={tap}>
        <ShareGlyph />
        {t("分享")}
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
  const tap = useEventShare(e, share, () => setOpen(true));
  if (!calendar && !share) return null;
  return (
    <div class="calendar">
      {calendar && <CalendarButton e={e} />}
      {share && (
        <button class="calendar-link" type="button" onClick={tap}>
          {t("分享")}
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

/** 分享 as the iOS share icon (a box with an arrow up), in the top corner of an open event's card. */
export function ShareIconButton(props: { e: EventSummary }) {
  const [open, setOpen] = useState(false);
  const tap = useEventShare(props.e, props.e.status === "open", () => setOpen(true));
  if (props.e.status !== "open") return null;
  return (
    <>
      <button class="share-icon" type="button" aria-label={t("分享")} title={t("分享")} onClick={tap}>
        <ShareGlyph />
      </button>
      {open && <EventShareSheet e={props.e} onClose={() => setOpen(false)} />}
    </>
  );
}

/** {@link useDirectShare} for an event's own card, only while it can be shared. */
function useEventShare(e: EventSummary, can: boolean, fallback: () => void): () => void {
  const site = useSiteTitle();
  const text = eventCardText(location.origin, e, t, (d) => fmtDate(d, false));
  return useDirectShare(() => drawShareCard(site, text), can ? `${site}|${JSON.stringify(text)}` : "", site, fallback);
}

function EventShareSheet(props: { e: EventSummary; onClose: () => void }) {
  const e = props.e;
  return (
    <ShareCardSheet text={eventCardText(location.origin, e, t, (d) => fmtDate(d, false))} onClose={props.onClose} />
  );
}

function ShareCardSheet(props: { text: CardText; onClose: () => void }) {
  const site = useSiteTitle();
  const [png, setPng] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    drawShareCard(site, props.text).then(setPng, () => setFailed(true));
  }, [site, props.text.url]);

  const words = [props.text.heading || site, ...props.text.lines].filter(Boolean).join("\n");
  return (
    <Panel title={t("分享")} label={t("分享")} onClose={props.onClose}>
      {failed && <p class="muted">{t("名片生成失败，请刷新后再试。")}</p>}
      {!failed && !png && <p class="muted">{t("正在生成…")}</p>}
      {png && (
        <>
          <img class="sharecard" src={png} alt={t("分享")} />
          <SystemShare png={png} name={site} words={words} url={props.text.url} />
        </>
      )}
    </Panel>
  );
}

type Sharing = Navigator & {
  share?: (data: { files?: File[]; title?: string; text?: string; url?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
};

/** A data: URL as a file, without fetch (the page's CSP doesn't allow fetching data: URLs). */
function pngFile(png: string, name: string): File {
  const bytes = atob(png.slice(png.indexOf(",") + 1));
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new File([buf], `${name}.png`, { type: "image/png" });
}

/** Whether this browser has a share sheet that takes a PNG (phones; not WeChat's browser, nor most computers). */
function canShareImages(): boolean {
  const nav = navigator as Sharing;
  try {
    return !!nav.share && !!nav.canShare?.({ files: [new File([""], "a.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "").trim() || "share";

/**
 * The tap on a 分享 icon: the phone's own share sheet (AirDrop, 信息, 微信 …) with the share image,
 * QR code and all, straight away (Ke Li 2026-11-19). Safari only opens the sheet right inside the tap,
 * so the image is drawn ahead, while the page is idle, as soon as the icon shows. Until it is ready,
 * and where there is no share sheet, the tap opens the image on its panel as before. `key` names
 * what is on the image; "" draws nothing.
 */
export function useDirectShare(draw: () => Promise<string>, key: string, name: string, fallback: () => void) {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    setFile(null);
    if (!key || !canShareImages()) return;
    let alive = true;
    const run = () => {
      draw().then(
        (png) => {
          if (!alive) return;
          const f = pngFile(png, safeName(name));
          if ((navigator as Sharing).canShare?.({ files: [f] })) setFile(f);
        },
        () => {},
      );
    };
    const idle = "requestIdleCallback" in window;
    const handle = idle ? requestIdleCallback(run, { timeout: 2000 }) : window.setTimeout(run, 300);
    return () => {
      alive = false;
      if (idle) cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [key]);
  return () => {
    const share = (navigator as Sharing).share;
    if (!file || !share) return fallback();
    // Closing the sheet rejects with AbortError: nothing to do. Anything else (the browser refused
    // the sheet) falls back to the image on its panel.
    share.call(navigator, { files: [file] }).catch((err: unknown) => {
      if ((err as { name?: string })?.name !== "AbortError") fallback();
    });
  };
}

/**
 * Under a share image: 分享图片 (and 分享链接 when there is a link) open the phone's own share sheet,
 * with AirDrop, 信息, 微信 and the rest (Ke Li 2026-11-19). Where the browser has no share sheet
 * (most computers, WeChat's built-in browser) the buttons aren't shown and the long-press hint is.
 * The file is made before the tap, so the share starts right inside the tap, which Safari requires.
 */
export function SystemShare(props: { png: string; name: string; words?: string; url?: string }) {
  const nav = navigator as Sharing;
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    try {
      const f = pngFile(props.png, safeName(props.name));
      setFile(nav.canShare?.({ files: [f] }) ? f : null);
    } catch {
      setFile(null);
    }
  }, [props.png, props.name]);
  const share = (data: Parameters<NonNullable<Sharing["share"]>>[0]) => {
    // A closed sheet rejects with AbortError; nothing to say either way.
    nav.share?.(data).catch(() => {});
  };
  const link = props.url && nav.share;
  return (
    <>
      {(file || link) && (
        <div class="share-actions">
          {file && (
            <button class="button block" type="button" onClick={() => share({ files: [file] })}>
              {t("分享图片")}
            </button>
          )}
          {link && (
            <button
              class={file ? "button secondary block" : "button block"}
              type="button"
              onClick={() => share({ title: props.name, text: props.words, url: props.url })}
            >
              {t("分享链接")}
            </button>
          )}
        </div>
      )}
      {!file && <p class="muted small center">{t("手机上长按图片即可保存或转发")}</p>}
    </>
  );
}
