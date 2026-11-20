import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { MILESTONES, type MilestoneKey } from "../shared/milestones";
import { shareColours } from "../shared/themes";
import type { YearReview } from "../shared/types";
import { kcalText } from "./Calories";
import { SectionTitle } from "./components";
import { useApi } from "./hooks";
import { t, tk } from "./i18n";
import { Panel } from "./Panel";
import { Avatar } from "./Avatar";
import { MeCard, type MeCardProps } from "./Profile";
import { ShareGlyph, SystemShare, drawQr, fitText, loadImage, roundRect, shareSans } from "./ShareCard";
import { myThemeId, useSiteTitle } from "./site";

/** Each badge's name, unit and line icon (24×24 path data, also drawn on the share image). */
const BADGES: Record<MilestoneKey, { name: string; unit: string; icon: string }> = {
  attendance: {
    name: tk("出勤"),
    unit: tk("次"),
    icon: "M9.4 18.5a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0M7 3.5h10l-2.4 12.4h-5.2zM10.3 3.5l.8 12.4M13.7 3.5l-.8 12.4",
  },
  hours: { name: tk("时长"), unit: tk("小时"), icon: "M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M12 7v5l3.5 2" },
  streak: {
    name: tk("连续"),
    unit: tk("场"),
    icon: "M12 3c.8 3.6 5 5.3 5 10.2a5 5 0 0 1-10 0c0-2.6 1.4-3.9 2.2-5.6.9 1 1.5 1.6 2.6 1.9-.5-2.2-.6-4.5.2-6.5z",
  },
  early: {
    name: tk("早鸟"),
    unit: tk("次"),
    icon: "M3.5 17.5h17M7 17.5a5 5 0 0 1 10 0M12 6v3M6.2 9.9l1.9 1.9M17.8 9.9l-1.9 1.9M8.5 21h7",
  },
  friends: {
    name: tk("带朋友"),
    unit: tk("人次"),
    icon: "M5.8 8.5a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0M14 9.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M3.5 20c0-3.6 2.5-5.6 5.5-5.6s5.5 2 5.5 5.6M15 14.6c3 0 5.5 1.7 5.5 5",
  },
  queue: {
    name: tk("排队功臣"),
    unit: tk("次"),
    icon: "M7.7 4.5h8.6a2.2 2.2 0 0 1 2.2 2.2v12.1a2.2 2.2 0 0 1-2.2 2.2H7.7a2.2 2.2 0 0 1-2.2-2.2V6.7a2.2 2.2 0 0 1 2.2-2.2zM9.5 3v3h5V3M9 11.5h6M9 15.5h4",
  },
};

/** Bronze, silver, gold (Ke Li picked the hexagon medal; the level shows in its colour). */
const TIER_COLOURS = [
  ["#d39a6c", "#94582f", "#ecd3bf", "#71411f"],
  ["#c9ced6", "#7d8794", "#e9ecf0", "#5d6672"],
  ["#f0c868", "#c08a22", "#f7e4b0", "#9a6d14"],
] as const;

const HEX = "M30 3l24 13.5v27L30 57 6 43.5v-27z";
const RIBBON = "M19 50h22v18l-11-6-11 6z";

/** One badge: the hexagon in its level's colour (grey until the first), a ribbon, the icon. */
function Medal(props: { k: MilestoneKey; tier: number }) {
  const c = props.tier ? TIER_COLOURS[props.tier - 1]! : null;
  const id = `medal-${props.k}`;
  return (
    <svg class="medal-svg" viewBox="0 0 60 70" aria-hidden="true">
      {c && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color={c[0]} />
            <stop offset="1" stop-color={c[1]} />
          </linearGradient>
        </defs>
      )}
      <path class="ribbon" d={RIBBON} style={c ? { fill: c[3] } : undefined} />
      <path class="hex" d={HEX} style={c ? { fill: `url(#${id})`, stroke: c[2] } : undefined} stroke-width="2" />
      <g transform="translate(16 15) scale(1.17)">
        <path class="glyph" d={BADGES[props.k].icon} />
      </g>
    </svg>
  );
}

/**
 * The top of a member's own 个人信息 (Ke Li 2026-11-10, option C): who they are with the year's
 * numbers inside the same accent card (any earlier year from the arrows, 分享 as an image), then
 * the badges in one row and the members they played with most (only here, never in the image).
 * Earlier the year was a card of its own under the profile card, whose counts didn't match it.
 */
export function YearReviewTop(props: { base: string; me: MeCardProps }) {
  const [year, setYear] = useState<number | null>(null);
  const [res] = useApi<YearReview>(`${props.base}/year${year ? `?year=${year}` : ""}`);
  const r = res.state === "ok" ? res.data : null;
  return (
    <>
      <MeCard {...props.me}>{r && <YearInCard review={r} name={props.me.name} pick={setYear} />}</MeCard>
      {r && <Milestones review={r} />}
      {r && r.buddies.length > 0 && <Buddies review={r} />}
    </>
  );
}

function YearInCard(props: { review: YearReview; name: string; pick: (y: number) => void }) {
  const r = props.review;
  const [sharing, setSharing] = useState(false);
  const i = r.years.indexOf(r.year);
  const older = r.years[i + 1];
  const newer = r.years[i - 1];
  return (
    <div class="year-card me-year">
      <div class="me-year-head">
        <h3>{t("你的 {year}", { year: r.year })}</h3>
        {r.years.length > 1 && (
          <span class="year-switch">
            <button
              type="button"
              aria-label={t("上一年")}
              disabled={older === undefined}
              onClick={() => older && props.pick(older)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label={t("下一年")}
              disabled={newer === undefined}
              onClick={() => newer && props.pick(newer)}
            >
              ›
            </button>
          </span>
        )}
        <button type="button" class="share-icon" aria-label={t("分享")} onClick={() => setSharing(true)}>
          <ShareGlyph />
        </button>
      </div>
      <div class="year-tiles">
        {yearTiles(r).map((x) => (
          <div key={x.label}>
            <b>{x.value}</b>
            <span>{x.label}</span>
          </div>
        ))}
        {r.venue && (
          <div class="wide">
            <b>{r.venue.name}</b>
            <span>{t("最常去的球馆 · {n} 次", { n: r.venue.count })}</span>
          </div>
        )}
      </div>
      {sharing && <YearShare review={r} name={props.name} onClose={() => setSharing(false)} />}
    </div>
  );
}

/** The six badges in one row: the colour is the level, underneath the way to the next one. Tap one for what it means. */
function Milestones(props: { review: YearReview }) {
  const [open, setOpen] = useState<YearReview["milestones"][number] | null>(null);
  return (
    <>
      <SectionTitle>{t("里程碑")}</SectionTitle>
      <section class="card medals">
        {props.review.milestones.map((m) => {
          const tiers = MILESTONES.find((x) => x.key === m.key)!.tiers;
          const b = BADGES[m.key];
          const shown = tiers[Math.max(0, m.tier - 1)]!;
          const next = tiers[m.tier];
          // The level's name in full for screen readers and on hover; the row only has room for the badge's.
          const title = `${t(b.name)} ${shown} ${t(b.unit)}`.trim();
          return (
            <button
              type="button"
              key={m.key}
              class={m.tier ? "medal" : "medal locked"}
              title={title}
              onClick={() => setOpen(m)}
            >
              <Medal k={m.key} tier={m.tier} />
              <span class="medal-name">{t(b.name)}</span>
              <small>{next === undefined ? m.value : `${m.value} / ${next}`}</small>
            </button>
          );
        })}
      </section>
      {open && <BadgeInfo m={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const TIER_NAMES = [tk("铜牌"), tk("银牌"), tk("金牌")];

/**
 * A badge explained (Ke Li 2026-11-10): what counts, that it adds up over all years, the three
 * levels with the ones reached ticked, and how far the next one is. A small card in the middle;
 * a tap anywhere (Ke Li: no 知道了 button) or Esc closes it.
 */
function BadgeInfo(props: { m: YearReview["milestones"][number]; onClose: () => void }) {
  const { m } = props;
  const b = BADGES[m.key];
  const tiers = MILESTONES.find((x) => x.key === m.key)!.tiers;
  const next = tiers[m.tier];
  const unit = t(b.unit);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: a tap closes it; Esc does too
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
    <div class="badge-backdrop" onClick={props.onClose}>
      <div class="badge-info" role="dialog" aria-label={t(b.name)}>
        <Medal k={m.key} tier={m.tier} />
        <h3>{t(b.name)}</h3>
        <p class="badge-desc">{t(BADGE_DESC[m.key])}</p>
        <p class="badge-now">
          {t("累计 {amount}", { amount: `${m.value} ${unit}`.trim() })}
          <small>{t("从入群到现在，不分年份")}</small>
        </p>
        <ol class="badge-tiers">
          {tiers.map((need, i) => (
            <li key={need} class={m.tier > i ? `got tier-${i + 1}` : `tier-${i + 1}`}>
              <span>
                {m.tier > i && "✓ "}
                {t(TIER_NAMES[i]!)}
              </span>
              <b>{`${need} ${unit}`.trim()}</b>
            </li>
          ))}
        </ol>
        <p class="badge-next">
          {next === undefined
            ? t("三级都拿到了！")
            : t("还差 {amount}升到{tier}", {
                amount: `${next - m.value} ${unit}`.trim(),
                tier: t(TIER_NAMES[m.tier]!),
              })}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** What each badge counts (the same words as its 排行榜). */
const BADGE_DESC: Record<MilestoneKey, string> = {
  attendance: tk("来打球的次数"),
  hours: tk("按报名时填的到/走时间算，没填按整场"),
  streak: tk("连续参加活动的最长场数"),
  early: tk("开放报名后前 5 个报名、并且来了的次数"),
  friends: tk("带朋友来打球的人次"),
  queue: tk("帮大家添加球馆账号、登记场地排队"),
};

/** 最常一起打球: up to five members side by side. */
function Buddies(props: { review: YearReview }) {
  return (
    <>
      <SectionTitle>{t("最常一起打球")}</SectionTitle>
      <section class="card buddies">
        {props.review.buddies.map((b, i) => (
          <div key={`${i}-${b.name}`} class="buddy">
            <Avatar src={b.avatar} size={46} class="buddy-av" />
            <b>{b.name}</b>
            <small>{t("{n} 次", { n: b.count })}</small>
          </div>
        ))}
      </section>
    </>
  );
}

/** The four numbers on the card: 千卡 when they read any that year, otherwise 带朋友. */
function yearTiles(r: YearReview) {
  return [
    { value: String(r.count), label: t("次活动") },
    { value: String(r.hours), label: t("小时在场上") },
    r.kcal !== null
      ? { value: kcalText(r.kcal), label: t("千卡") }
      : { value: String(r.friends), label: t("人次带朋友") },
    { value: String(r.early), label: t("次早鸟") },
  ];
}

const QR_KEY = "year-card-qr";

function YearShare(props: { review: YearReview; name: string; onClose: () => void }) {
  const site = useSiteTitle();
  const [png, setPng] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Whether the card carries the group's QR code: theirs to choose, remembered on this phone.
  const [qr, setQr] = useState(() => {
    try {
      return localStorage.getItem(QR_KEY) !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    let alive = true;
    drawYearCard(site, props.name, props.review, qr).then(
      (p) => alive && setPng(p),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [site, props.name, props.review, qr]);
  const pick = (on: boolean) => {
    setQr(on);
    try {
      localStorage.setItem(QR_KEY, on ? "1" : "0");
    } catch {}
  };
  return (
    <Panel title={t("分享")} label={t("分享")} onClose={props.onClose}>
      {failed && <p class="muted">{t("图片生成失败，请刷新后再试。")}</p>}
      {!failed && !png && <p class="muted">{t("正在生成…")}</p>}
      {png && (
        <>
          <img class="sharecard" src={png} alt={t("你的 {year}", { year: props.review.year })} />
          <SystemShare
            png={png}
            name={site}
            imageLabel={t("分享图片")}
            lead={
              <label class="switch-card share-switch">
                <strong>{t("显示二维码")}</strong>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={qr}
                  checked={qr}
                  onChange={(e) => pick((e.target as HTMLInputElement).checked)}
                />
              </label>
            }
          />
        </>
      )}
    </Panel>
  );
}

/**
 * The 年度回顾 share image: the site's logo and name, their name and year, the four numbers and
 * the venue, and the badges they have. Never who they played with: those are other people.
 */
export async function drawYearCard(siteTitle: string, name: string, r: YearReview, qr = false): Promise<string> {
  const W = 1080;
  // As tall as what is on it: the link line at the bottom is gone (Ke Li 2026-11-19).
  const hasBadges = r.milestones.some((m) => m.tier > 0);
  const H = 360 + 2 * (190 + 24) + (r.venue ? 160 + 24 : 0) + (hasBadges ? 40 + 120 : 0) + 90;
  const SANS = shareSans();
  const logo = await loadImage("/icon.svg");
  const QRCode = qr ? await import("qrcode") : null;
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  // Personal, so in the member's own colours like the card on their page (Ke Li 2026-11-11).
  const colours = shareColours(myThemeId());
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, colours.from);
  bg.addColorStop(1, colours.to);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Logo and site name, top left.
  ctx.save();
  ctx.fillStyle = "#fff";
  roundRect(ctx, 70, 64, 104, 104, 28);
  ctx.fill();
  ctx.restore();
  ctx.drawImage(logo, 76, 70, 92, 92);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.font = `700 46px ${SANS}`;
  ctx.fillText(fitText(ctx, siteTitle, qr ? W - 460 : W - 280), 204, 116);

  ctx.textBaseline = "alphabetic";
  ctx.font = `800 88px ${SANS}`;
  ctx.fillText(fitText(ctx, t("{name} 的 {year}", { name, year: r.year }), W - 140), 70, 300);

  // 2 × 2 numbers, then the venue across.
  const tiles = yearTiles(r);
  const gap = 24;
  const tw = (W - 140 - gap) / 2;
  const th = 190;
  tiles.forEach((x, i) => {
    const tx = 70 + (i % 2) * (tw + gap);
    const ty = 360 + Math.floor(i / 2) * (th + gap);
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    roundRect(ctx, tx, ty, tw, th, 32);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `800 80px ${SANS}`;
    ctx.fillText(fitText(ctx, x.value, tw - 60), tx + 34, ty + 106);
    ctx.font = `500 34px ${SANS}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(fitText(ctx, x.label, tw - 60), tx + 34, ty + 160);
  });
  let y = 360 + 2 * (th + gap);
  if (r.venue) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    roundRect(ctx, 70, y, W - 140, 160, 32);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 48px ${SANS}`;
    ctx.fillText(fitText(ctx, r.venue.name, W - 210), 104, y + 74);
    ctx.font = `500 34px ${SANS}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(t("最常去的球馆 · {n} 次", { n: r.venue.count }), 104, y + 126);
    y += 160 + gap;
  }

  // The badges they have, highest first.
  const got = r.milestones.filter((m) => m.tier > 0).sort((a, b) => b.tier - a.tier);
  const size = 120;
  const shown = got.slice(0, 6);
  const step = size + 36;
  const left = (W - (shown.length * step - 36)) / 2;
  shown.forEach((m, i) => drawMedal(ctx, m.key, m.tier, left + i * step, y + 40, size));

  // The group's QR code, small and top right, beside the group's name: the person is the point of
  // this card (Ke Li 2026-11-19, option C). No link written out any more.
  if (QRCode) {
    const m = QRCode.create(`${location.origin}/`, { errorCorrectionLevel: "H" }).modules;
    const s = 140;
    const pad = 12;
    const x = W - 70 - pad - s;
    const y = 56;
    ctx.save();
    ctx.fillStyle = "#fff";
    roundRect(ctx, x - pad, y - pad, s + pad * 2, s + pad * 2, 24);
    ctx.fill();
    ctx.restore();
    drawQr(ctx, m, logo, x, y, s, colours.ink);
  }
  return canvas.toDataURL("image/png");
}

function drawMedal(ctx: CanvasRenderingContext2D, key: MilestoneKey, tier: number, x: number, y: number, size: number) {
  const c = TIER_COLOURS[tier - 1]!;
  const s = size / 60;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = c[3];
  ctx.fill(new Path2D(RIBBON));
  const g = ctx.createLinearGradient(0, 3, 0, 57);
  g.addColorStop(0, c[0]);
  g.addColorStop(1, c[1]);
  ctx.fillStyle = g;
  ctx.strokeStyle = c[2];
  ctx.lineWidth = 2;
  const hex = new Path2D(HEX);
  ctx.fill(hex);
  ctx.stroke(hex);
  ctx.translate(16, 15);
  ctx.scale(1.17, 1.17);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(BADGES[key].icon));
  ctx.restore();
}
