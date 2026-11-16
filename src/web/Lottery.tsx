import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  LOTTERY_ANIM_MS,
  LOTTERY_CHEERS_MAX,
  type LotteryEntry,
  type LotteryView,
  type LotteryWinner,
  drawEnd,
  drawLand,
  drawStart,
  heatOf,
} from "../shared/lottery";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { StatusPill, monthDay } from "./events";
import { Panel } from "./Panel";
import { fmtInstant, t, weekdayOf } from "./i18n";
import { clock } from "./Stay";
import { toPacific } from "../shared/time";

/**
 * 抽奖 (Ke Li 2026-11-16, option C 百人头像墙): the faces of everyone on the list on one wall; at
 * 开奖 a shuttle hops across it, slowing down, and lands on a winner, one prize after another. Every
 * phone plays the same draw at the same moment, by the server's clock (shared/lottery.ts drawStart).
 * The 管理页's 预演 shows the same page.
 */

/** "037": the number on a face. */
export const num3 = (rank: number) => String(rank).padStart(3, "0");

type Res = { lottery: LotteryView | null };

/** The server's clock: its time when the answer came, carried forward on this phone's. */
export function useClock(view: LotteryView | null) {
  const offset = useRef(0);
  useEffect(() => {
    if (view) offset.current = Date.parse(view.now) - Date.now();
  }, [view?.now]);
  return () => Date.now() + offset.current;
}

/** Re-render every `ms` while `on`. */
function useTick(on: boolean, ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [on, ms]);
}

/**
 * On 我的活动: a card for the 抽奖 under way, which opens the page. Opens by itself from a push
 * (/me?lottery=1).
 */
export function LotteryCard(props: { base: string }) {
  const [res, setRes] = useState<LotteryView | null>(null);
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get("lottery") === "1");
  useEffect(() => {
    let alive = true;
    api<Res>(`${props.base}/lottery`)
      .then((r) => alive && setRes(r.lottery))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [props.base, open]);
  const close = () => {
    setOpen(false);
    // So a reload doesn't open it again.
    if (location.search.includes("lottery=1")) history.replaceState(history.state, "", location.pathname);
  };
  if (!res) return null;
  const l = res;
  const drawn = l.status === "drawn";
  const line = drawn ? (l.seed ? t("开奖结果出来了") : t("正在直播开奖")) : t("抽奖");
  const pill = l.me?.inPool ? t("你的抽奖号 {n}", { n: num3(l.me.rank ?? 0) }) : t("抽奖");
  const when = toPacific(l.drawAt);
  return (
    <>
      {/* Like an event's card (Ke Li 2026-11-16: 看起来像一次活动，用风格类似的活动卡片). */}
      <section class="card ev-card tone-hero lot-ev">
        <button type="button" class="ev-head lot-ev-head" onClick={() => setOpen(true)}>
          <span class="hero-top">
            <StatusPill cls={l.me?.inPool ? "mine" : "open"} label={pill} />
            <span>{line}</span>
          </span>
          <span class="hero-date">
            {monthDay(when.date)}
            <small>
              {weekdayOf(when.date)} {clock(when.time)}
            </small>
          </span>
          <span class="hero-what">
            <span aria-hidden="true">{drawn && l.seed ? "🏆" : "🎉"}</span> {l.title}
          </span>
          <span class="next-cta">{t("查看")}</span>
        </button>
      </section>
      {open && (
        <Panel title={l.title} label={l.title} onClose={close}>
          <LotteryLive base={props.base} first={l} />
        </Panel>
      )}
    </>
  );
}

/** The page for a member: asks again every few seconds (more often while the draw is on). */
function LotteryLive(props: { base: string; first: LotteryView }) {
  const [view, setView] = useState<LotteryView>(props.first);
  const clock = useClock(view);
  const done = view.status === "drawn" && !!view.seed;
  const drawAt = Date.parse(view.drawAt);
  useEffect(() => {
    if (done) return;
    let alive = true;
    let n = 0;
    const load = () =>
      api<Res>(`${props.base}/lottery`)
        .then((r) => alive && r.lottery && setView(r.lottery))
        .catch(() => undefined);
    // Each second: ask every 4 s before the draw (who is watching, who is 打气); every second around the
    // end of the countdown, so the draw starts on time (it starts by itself, the first asking
    // records it); every 2 s while it plays, so each winner arrives before its shuttle sets off.
    const id = setInterval(() => {
      n++;
      const left = drawAt - clock();
      const every = view.status === "drawn" ? 2 : left < 15_000 ? 1 : 4;
      if (n % every === 0) void load();
    }, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [props.base, view.status, done, drawAt]);
  return <LotteryShow view={view} clock={clock} base={props.base} />;
}

/** The page itself: the banner with one's own number, the wall, 打气, the winners. */
export function LotteryShow(props: { view: LotteryView; clock: () => number; base?: string }) {
  const v = props.view;
  const now = props.clock();
  const drawnAt = v.drawnAt ? Date.parse(v.drawnAt) : null;
  const total = v.draws;
  const finished = drawnAt !== null && v.winners.length === total && now >= drawEnd(drawnAt, total);
  const live = drawnAt !== null && !finished;
  // Ticking: the countdown every second, the draw ten times a second.
  useTick(true, live ? 100 : 1000);
  const landed = drawnAt === null ? [] : v.winners.filter((w) => now >= drawLand(drawnAt, w.drawNo));
  const flying =
    drawnAt === null
      ? undefined
      : v.winners.find((w) => now >= drawStart(drawnAt, w.drawNo) && now < drawLand(drawnAt, w.drawNo));
  const latest = landed[landed.length - 1];
  const byRank = useMemo(() => new Map(v.entries.map((e) => [e.rank, e])), [v.entries]);
  const cheer = useCheer(v, props.base);
  return (
    <div class="lot">
      {v.rehearsal && <p class="lot-rehearsal">{t("预演 · 只有你看得到，不算数")}</p>}
      <Header v={v} now={now} live={live} finished={finished} flying={flying} latest={latest} byRank={byRank} />
      <Wall
        v={v}
        now={now}
        landed={landed}
        flying={flying}
        dim={!finished && !v.rehearsal}
        me={v.me?.id ?? null}
        pulse={cheer.taps}
      />
      {drawnAt === null && !v.rehearsal && <Cheer v={v} cheer={cheer} />}
      {drawnAt !== null && <Winners v={v} landed={landed} byRank={byRank} finished={finished} />}
    </div>
  );
}

/** One's own place, on the banner: the number in the draw, or why not this time. */
function Ticket(props: { v: LotteryView }) {
  const me = props.v.me;
  if (!me) return null;
  if (me.inPool)
    return (
      <p class="lot-ticket">
        <span aria-hidden="true">🎟</span> {t("你的抽奖号 {n}", { n: num3(me.rank ?? 0) })}
      </p>
    );
  return (
    <p class="lot-ticket out">
      {me.rank && me.rank > props.v.poolSize ? t("你是第 {n} 位入群的球友", { n: me.rank }) : t("这次你不参加抽奖")}
    </p>
  );
}

function Header(props: {
  v: LotteryView;
  now: number;
  live: boolean;
  finished: boolean;
  flying?: LotteryWinner;
  latest?: LotteryWinner;
  byRank: Map<number, LotteryEntry>;
}) {
  const { v, now } = props;
  if (props.finished)
    return (
      <section class="lot-hero">
        <div class="lot-hero-icon" aria-hidden="true">
          🏆
        </div>
        <h2>{t("开奖结果")}</h2>
        <p>{v.host ? t("请中奖的球友联系 {name} 领奖", { name: v.host }) : null}</p>
        <Ticket v={v} />
      </section>
    );
  if (props.live) {
    const w = props.flying;
    const last = props.latest;
    const who = last && props.byRank.get(last.rank);
    return (
      <section class="lot-hero live">
        <p class="lot-live">
          <span class="lot-dot" aria-hidden="true" />
          {v.rehearsal ? t("预演开奖中") : t("直播开奖中 · {n} 人在看", { n: v.watching })}
        </p>
        {w ? (
          <h2>{t("第 {k} / {n} 次 · {prize}", { k: w.drawNo, n: v.draws, prize: w.prize })}</h2>
        ) : last && who ? (
          <h2 class="lot-landed">{t("落在了 {n} 号 {name}！", { n: num3(last.rank), name: who.name })}</h2>
        ) : (
          <h2>{t("羽毛球准备发出…")}</h2>
        )}
        <p>{w ? t("羽毛球飞呀飞…") : last ? t("恭喜！抽中 {prize}", { prize: last.prize }) : " "}</p>
      </section>
    );
  }
  const left = Math.max(0, Date.parse(v.drawAt) - now);
  const parts = [
    Math.floor(left / 86_400_000),
    Math.floor(left / 3_600_000) % 24,
    Math.floor(left / 60_000) % 60,
    Math.floor(left / 1000) % 60,
  ];
  const units = [t("天"), t("时"), t("分"), t("秒")];
  return (
    <section class="lot-hero">
      <div class="lot-hero-icon" aria-hidden="true">
        🎉
      </div>
      <h2>{v.title}</h2>
      <p>{t("前 {n} 名入群的球友，抽 {k} 位幸运儿", { n: v.poolSize, k: v.draws })}</p>
      {left > 0 ? (
        <div class="lot-count" role="timer">
          {parts.map((p, i) => (
            <span key={units[i]}>
              <b>{String(p).padStart(2, "0")}</b>
              {units[i]}
            </span>
          ))}
        </div>
      ) : (
        <p class="lot-soon">{t("开奖啦！")}</p>
      )}
      <p>{t("{time} 开奖", { time: fmtInstant(v.drawAt) })}</p>
      <ul class="lot-chips">
        {v.prizes.map((p) => (
          <li key={p.name}>
            <span aria-hidden="true">🏸</span> {p.name} <b>×{p.count}</b>
          </li>
        ))}
      </ul>
      <Ticket v={v} />
    </section>
  );
}

/** A small seeded random, so every phone hops the shuttle over the same faces. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Rallies before the last stroke. */
const RALLIES = 8;
/** The last stroke, a 杀球, sets off this long before the draw lands. */
const SMASH_MS = 380;

type Stroke = "serve" | "drive" | "drop" | "smash";

/**
 * Draw `w` as a rally (Ke Li 2026-11-16: 球拍在抽球，杀球，吊球让球运动): a serve from the bottom
 * of the wall, then the shuttle is driven and dropped from face to face, slower and slower, and the
 * last stroke smashes it onto the winner, where its head lands as the face lights up. The same on
 * every phone: the faces and strokes come from the fingerprint.
 */
function strokesFor(v: LotteryView, w: LotteryWinner, start: number) {
  const r = rng(`${v.seedHash}:${w.drawNo}`);
  const span = LOTTERY_ANIM_MS - SMASH_MS;
  const out: { at: number; rank: number; kind: Stroke }[] = [];
  for (let i = 0; i < RALLIES; i++) {
    // Never the winner before the end, never the same face twice running.
    let rank = w.rank;
    for (let tries = 0; tries < 8 && (rank === w.rank || rank === out[i - 1]?.rank); tries++)
      rank = v.entries[Math.floor(r() * v.entries.length)]?.rank ?? w.rank;
    out.push({ at: start + span * (i / RALLIES) ** 1.4, rank, kind: i === 0 ? "serve" : r() < 0.5 ? "drive" : "drop" });
  }
  out.push({ at: start + span, rank: w.rank, kind: "smash" });
  return out;
}

const STROKE_NAME: Record<Stroke, () => string> = {
  serve: () => t("发球"),
  drive: () => t("抽球"),
  drop: () => t("吊球"),
  smash: () => t("杀球！"),
};

function Wall(props: {
  v: LotteryView;
  now: number;
  landed: LotteryWinner[];
  flying?: LotteryWinner;
  dim: boolean;
  me: string | null;
  /** One's own 打气 taps so far on this page: each makes one's own face jump at once. */
  pulse: number;
}) {
  const { v, now } = props;
  const cheering = useCheering(v, props.me, props.pulse);
  const n = v.entries.length;
  const cols = Math.max(5, Math.min(10, Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);
  const won = new Map(props.landed.map((w) => [w.rank, w]));
  const cell = (rank: number) => {
    const i = v.entries.findIndex((e) => e.rank === rank);
    return i < 0 ? null : { col: i % cols, row: Math.floor(i / cols) };
  };
  const place = (c: { col: number; row: number }) => ({
    left: `${(c.col + 0.5) * (100 / cols)}%`,
    top: `${(c.row + 0.5) * (100 / rows)}%`,
  });
  // The stroke being played: whose racket hits, where the shuttle flies to, how, and for how long.
  let at: { no: string; rank: number; kind: Stroke; ms: number; from: { col: number; row: number } } | null = null;
  if (props.flying && v.drawnAt) {
    const strokes = strokesFor(v, props.flying, drawStart(Date.parse(v.drawnAt), props.flying.drawNo));
    let i = 0;
    while (i + 1 < strokes.length && strokes[i + 1]!.at <= now) i++;
    const s = strokes[i]!;
    const gap = Math.max(120, (strokes[i + 1]?.at ?? s.at + SMASH_MS) - s.at);
    at = {
      no: `${props.flying.drawNo}-${i}`,
      rank: s.rank,
      kind: s.kind,
      ms: s.kind === "smash" ? SMASH_MS - 80 : s.kind === "drop" ? Math.min(gap * 0.85, 900) : Math.min(gap * 0.6, 450),
      // The serve comes from under the wall.
      from: (i > 0 && cell(strokes[i - 1]!.rank)) || { col: (cols - 1) / 2, row: rows - 0.2 },
    };
  }
  const latest = props.landed[props.landed.length - 1];
  const just = !props.flying && latest && v.drawnAt && now - drawLand(Date.parse(v.drawnAt), latest.drawNo) < 5000;
  const target = at?.rank ?? (just ? latest.rank : null);
  const to = target === null ? null : cell(target);
  // The head (cork) leads: the shuttle points the way it flies; landed, it stands head down.
  const angle = at && to ? (Math.atan2(to.row - at.from.row, to.col - at.from.col) * 180) / Math.PI - 90 : 0;
  return (
    <section class="card lot-wall-card">
      <div class={n <= 5 ? "lot-wall few" : "lot-wall"} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {v.entries.map((e) => {
          const w = won.get(e.rank);
          const cls = [
            "lot-face",
            w ? "won" : "",
            e.rank === target ? (at ? "hover" : "hit") : "",
            props.dim && !e.online && !w ? "away" : "",
            e.id === props.me ? "me" : "",
            cheering.has(e.id) ? "cheer" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <span key={e.rank} class={cls} title={`${num3(e.rank)} ${e.name}`}>
              {e.avatar ? (
                <Avatar src={e.avatar} size={28} />
              ) : (
                <span class="lot-initial">{[...e.name][0] ?? "?"}</span>
              )}
              <small>{e.rank}</small>
              {w && <i class="lot-prize">{w.prize}</i>}
              {cheering.has(e.id) && (
                <i class="lot-horn" key={cheering.get(e.id)} aria-hidden="true">
                  📣
                </i>
              )}
            </span>
          );
        })}
        {at && (
          <span class={`lot-racket k-${at.kind}`} key={`r${at.no}`} aria-hidden="true" style={place(at.from)}>
            <Racket />
            <b>{STROKE_NAME[at.kind]()}</b>
          </span>
        )}
        {to && (
          <span
            class={just ? "lot-shuttle landed" : `lot-shuttle k-${at?.kind}`}
            aria-hidden="true"
            style={{ ...place(to), transitionDuration: `${at ? Math.round(at.ms) : 200}ms` }}
          >
            <span
              class="lot-arc"
              key={`a${at?.no ?? "landed"}`}
              style={{ animationDuration: `${Math.round(at?.ms ?? 0)}ms` }}
            >
              <span class="lot-rot" style={{ transform: `rotate(${angle.toFixed(1)}deg)` }}>
                <Shuttle />
              </span>
            </span>
          </span>
        )}
        {just && to && (
          <span class="lot-burst" aria-hidden="true" style={place(to)}>
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ "--a": `${i * 26}deg`, "--d": `${(i % 3) * 60}ms` }} />
            ))}
          </span>
        )}
      </div>
    </section>
  );
}

/** Head (cork) down, at the bottom middle: that point is where the shuttle is. */
const Shuttle = () => (
  <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
    <path d="M24 34 L8 5 Q24 -1 40 5 Z" fill="#fff" stroke="#8d877e" stroke-width="1.6" stroke-linejoin="round" />
    <path
      d="M24 34 L16 4 M24 34 L24 2.5 M24 34 L32 4 M12.5 13 Q24 9 35.5 13 M17 22 Q24 19.5 31 22"
      fill="none"
      stroke="#bdb6ab"
      stroke-width="1.2"
    />
    <rect x="16.5" y="30" width="15" height="5" rx="1.5" fill="#e0483e" />
    <path
      d="M17 35 H31 V38 A7 8 0 0 1 17 38 Z"
      fill="#fbf6ee"
      stroke="#8d877e"
      stroke-width="1.6"
      stroke-linejoin="round"
    />
  </svg>
);

/** Handle down: it swings about the end of the handle. */
const Racket = () => (
  <svg viewBox="0 0 40 72" width="40" height="72" aria-hidden="true">
    <ellipse cx="20" cy="19" rx="15" ry="17.5" fill="rgba(255,255,255,0.55)" stroke="#45294a" stroke-width="3" />
    <path
      d="M9 12 H31 M6 19 H34 M9 26 H31 M13 4 V34 M20 2 V36 M27 4 V34"
      stroke="#45294a"
      stroke-width="0.8"
      opacity="0.6"
    />
    <path d="M20 36.5 V56" stroke="#45294a" stroke-width="3" stroke-linecap="round" />
    <rect x="17" y="54" width="6" height="17" rx="2.5" fill="#c9952b" />
  </svg>
);

/** 打气: taps add up on this phone and go out a second later, a few at a time. */
function useCheer(v: LotteryView, base?: string) {
  const [extra, setExtra] = useState(0);
  const [taps, setTaps] = useState(0);
  const [totals, setTotals] = useState<{ cheers: number; mine: number } | null>(null);
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the page was told last wins once it is newer than what 打气 answered.
  const mine = Math.min(Math.max(totals?.mine ?? 0, v.me?.cheers ?? 0) + extra, LOTTERY_CHEERS_MAX);
  const all = Math.max(totals?.cheers ?? 0, v.cheers) + extra;
  const can = !!base && !!v.me && v.status === "open" && mine < LOTTERY_CHEERS_MAX;
  const tap = () => {
    if (!can) return;
    pending.current++;
    setExtra((x) => x + 1);
    setTaps((x) => x + 1);
    timer.current ??= setTimeout(() => {
      const n = pending.current;
      pending.current = 0;
      timer.current = null;
      api<{ cheers: number; mine: number }>(`${base}/lottery/cheer`, { n })
        .then((r) => {
          setTotals(r);
          setExtra((x) => Math.max(0, x - n));
        })
        .catch(() => setExtra((x) => Math.max(0, x - n)));
    }, 1000);
  };
  return { mine, all, can, tap, taps };
}

const CHEER_MS = 1400;

/**
 * Who is 打气 right now (Ke Li 2026-11-16: 做成有互动性的): the faces whose count went up since the
 * page last asked, and one's own at each tap. Each jumps and sends up a 📣 for a moment. The value
 * is a key that changes with each jump, so the animation starts again.
 */
function useCheering(v: LotteryView, me: string | null, pulse: number): Map<string, number> {
  const [on, setOn] = useState<Map<string, number>>(new Map());
  const before = useRef<Map<string, number> | null>(null);
  const jump = (ids: string[]) => {
    if (ids.length === 0) return;
    const key = Date.now();
    setOn((m) => new Map([...m, ...ids.map((id) => [id, key] as const)]));
    setTimeout(() => setOn((m) => new Map([...m].filter(([, k]) => k !== key))), CHEER_MS);
  };
  useEffect(() => {
    const was = before.current;
    before.current = new Map(v.entries.map((e) => [e.id, e.cheers]));
    if (was) jump(v.entries.filter((e) => e.id !== me && e.cheers > (was.get(e.id) ?? 0)).map((e) => e.id));
  }, [v.entries]);
  useEffect(() => {
    if (pulse > 0 && me) jump([me]);
  }, [pulse]);
  return on;
}

/** 打气: the group's 热度 climbing level by level, the three who cheer most, and the button. */
function Cheer(props: { v: LotteryView; cheer: ReturnType<typeof useCheer> }) {
  const { v, cheer } = props;
  const heat = heatOf(cheer.all);
  const top = [...v.entries]
    .filter((e) => e.cheers > 0)
    .sort((a, b) => b.cheers - a.cheers || a.rank - b.rank)
    .slice(0, 3);
  // The 📣 that fly up from the button, one a tap.
  const [flying, setFlying] = useState<number[]>([]);
  const tap = () => {
    if (!cheer.can) return;
    cheer.tap();
    const id = Date.now() + Math.random();
    setFlying((f) => [...f, id]);
    setTimeout(() => setFlying((f) => f.filter((x) => x !== id)), 900);
  };
  return (
    <section class="card lot-cheer-card">
      <div class="lot-heat-row">
        <strong>
          <span aria-hidden="true">🔥</span> {t("热度")} Lv.{heat.level}
        </strong>
        <span class="lot-heat-n">
          <b>{cheer.all}</b>
          {heat.next !== null && ` / ${heat.next}`}
        </span>
      </div>
      <div
        class="lot-heat"
        role="progressbar"
        aria-valuenow={Math.round(heat.part * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${Math.round(heat.part * 100)}%` }} />
      </div>
      {top.length > 0 && (
        <div class="lot-top">
          <span class="lot-top-label">{t("气氛组")}</span>
          {top.map((e) => (
            <span key={e.id} class="lot-top-one">
              <Avatar src={e.avatar} size={26} />
              {e.name}
              <b>{e.cheers}</b>
            </span>
          ))}
        </div>
      )}
      {v.me && (
        <button type="button" class="lot-cheer" onClick={tap} disabled={!cheer.can}>
          {t("📣 打气")}
          {cheer.mine > 0 && <b>×{cheer.mine}</b>}
          {flying.map((id) => (
            <i key={id} aria-hidden="true" style={{ "--x": `${(id % 7) * 12 - 36}px` }}>
              📣
            </i>
          ))}
        </button>
      )}
    </section>
  );
}

function Winners(props: {
  v: LotteryView;
  landed: LotteryWinner[];
  byRank: Map<number, LotteryEntry>;
  finished: boolean;
}) {
  const slots = Array.from({ length: props.v.draws }, (_, i) => props.landed[i]);
  const names = props.v.prizes.flatMap((p) => Array<string>(p.count).fill(p.name));
  return (
    <section class="card">
      <h2>{t("中奖名单")}</h2>
      <ol class="lot-winners">
        {slots.map((w, i) => {
          const e = w && props.byRank.get(w.rank);
          return (
            <li key={i} class={w ? "" : "wait"}>
              <span class="lot-no">{w ? num3(w.rank) : `#${i + 1}`}</span>
              {e ? <Avatar src={e.avatar} size={30} /> : <span class="lot-blank" />}
              <span class="lot-name">{e ? e.name : t("即将揭晓")}</span>
              <span class="lot-tag">{w?.prize ?? names[i]}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
