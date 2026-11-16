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
  drawWinners,
  sha256Hex,
} from "../shared/lottery";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { Panel } from "./Panel";
import { fmtInstant, t } from "./i18n";

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
  const line = drawn
    ? l.seed
      ? t("开奖结果出来了，看看谁是幸运儿")
      : t("正在直播开奖，快来围观")
    : t("{time} 开奖", { time: fmtInstant(l.drawAt) });
  return (
    <>
      <button type="button" class="lot-card" onClick={() => setOpen(true)}>
        <span class="lot-card-icon" aria-hidden="true">
          {drawn && l.seed ? "🏆" : "🎉"}
        </span>
        <span class="lot-card-text">
          <strong>{l.title}</strong>
          <span>{line}</span>
          {l.me?.inPool && <span>{t("你的抽奖号 {n}", { n: num3(l.me.rank ?? 0) })}</span>}
        </span>
        <span class="lot-card-go" aria-hidden="true">
          ›
        </span>
      </button>
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
    // Each second: ask every 10 s before the draw (who is watching, 打气); every second around the
    // end of the countdown, so the draw starts on time (it starts by itself, the first asking
    // records it); every 2 s while it plays, so each winner arrives before its shuttle sets off.
    const id = setInterval(() => {
      n++;
      const left = drawAt - clock();
      const every = view.status === "drawn" ? 2 : left < 15_000 ? 1 : 10;
      if (n % every === 0) void load();
    }, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [props.base, view.status, done, drawAt]);
  return <LotteryShow view={view} clock={clock} base={props.base} />;
}

/** The page itself: header, the wall, one's own number, the winners and 核对. */
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
  return (
    <div class="lot">
      {v.rehearsal && <p class="lot-rehearsal">{t("预演 · 只有你看得到，不算数")}</p>}
      <Header v={v} now={now} live={live} finished={finished} flying={flying} latest={latest} byRank={byRank} />
      <Wall v={v} now={now} landed={landed} flying={flying} dim={!finished && !v.rehearsal} me={v.me?.id ?? null} />
      {!finished && !v.rehearsal && (
        <p class="muted small lot-note">{t("灰色的头像是还没打开这一页的人，只是好玩，不影响中奖。")}</p>
      )}
      {v.me && <Mine v={v} base={props.base} finished={finished} />}
      {drawnAt === null ? <Prizes v={v} /> : <Winners v={v} landed={landed} byRank={byRank} finished={finished} />}
      <Fair v={v} finished={finished} />
    </div>
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
        🎉🏸
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

const HOPS = 16;

/**
 * Where the shuttle is during draw `w`: the faces it hops to, slower and slower, reaching the winner
 * a little before it lands, so it is there when the face lights up.
 */
function hopsFor(v: LotteryView, w: LotteryWinner, start: number) {
  const r = rng(`${v.seedHash}:${w.drawNo}`);
  const span = LOTTERY_ANIM_MS * 0.85;
  const out: { at: number; rank: number }[] = [];
  for (let i = 0; i < HOPS; i++) {
    const e = v.entries[Math.floor(r() * v.entries.length)];
    out.push({ at: start + span * (i / HOPS) ** 1.7, rank: e ? e.rank : w.rank });
  }
  out.push({ at: start + span, rank: w.rank });
  return out;
}

function Wall(props: {
  v: LotteryView;
  now: number;
  landed: LotteryWinner[];
  flying?: LotteryWinner;
  dim: boolean;
  me: string | null;
}) {
  const { v, now } = props;
  const n = v.entries.length;
  const cols = Math.max(5, Math.min(10, Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);
  const won = new Map(props.landed.map((w) => [w.rank, w]));
  // The shuttle: where it is now and how long its hop there takes.
  let at: { rank: number; ms: number } | null = null;
  if (props.flying && v.drawnAt) {
    const hops = hopsFor(v, props.flying, drawStart(Date.parse(v.drawnAt), props.flying.drawNo));
    let i = 0;
    while (i + 1 < hops.length && hops[i + 1]!.at <= now) i++;
    at = { rank: hops[i]!.rank, ms: Math.max(80, (hops[i + 1]?.at ?? hops[i]!.at) - hops[i]!.at) };
  }
  const latest = props.landed[props.landed.length - 1];
  const just = !props.flying && latest && v.drawnAt && now - drawLand(Date.parse(v.drawnAt), latest.drawNo) < 5000;
  const target = at?.rank ?? (just ? latest.rank : null);
  const index = target === null ? -1 : v.entries.findIndex((e) => e.rank === target);
  return (
    <section class="card lot-wall-card">
      <div class="lot-wall" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {v.entries.map((e) => {
          const w = won.get(e.rank);
          const cls = [
            "lot-face",
            w ? "won" : "",
            e.rank === target ? (at ? "hover" : "hit") : "",
            props.dim && !e.online && !w ? "away" : "",
            e.id === props.me ? "me" : "",
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
            </span>
          );
        })}
        {index >= 0 && (
          <span
            class={just ? "lot-shuttle landed" : "lot-shuttle"}
            aria-hidden="true"
            style={{
              left: `${((index % cols) + 0.5) * (100 / cols)}%`,
              top: `${(Math.floor(index / cols) + 0.5) * (100 / rows)}%`,
              transitionDuration: `${at ? Math.min(at.ms, 700) : 300}ms`,
            }}
          >
            <Shuttle />
          </span>
        )}
        {just && index >= 0 && (
          <span
            class="lot-burst"
            aria-hidden="true"
            style={{
              left: `${((index % cols) + 0.5) * (100 / cols)}%`,
              top: `${(Math.floor(index / cols) + 0.5) * (100 / rows)}%`,
            }}
          >
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ "--a": `${i * 26}deg`, "--d": `${(i % 3) * 60}ms` }} />
            ))}
          </span>
        )}
      </div>
    </section>
  );
}

const Shuttle = () => (
  <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
    <path d="M16 2 L9 18 L23 18 Z" fill="#fff" stroke="#9a948b" stroke-width="1.2" />
    <path d="M12.5 10 L19.5 10 M11 14 L21 14 M16 2 L16 18" stroke="#c9c3ba" stroke-width="1" />
    <ellipse cx="16" cy="19.5" rx="7.5" ry="2.2" fill="#e0483e" />
    <path d="M10 20 Q16 31 22 20 Z" fill="#f4efe8" stroke="#9a948b" stroke-width="1.2" />
  </svg>
);

/** 打气: taps add up on this phone and go out a second later, a few at a time. */
function Mine(props: { v: LotteryView; base?: string; finished: boolean }) {
  const me = props.v.me!;
  const [extra, setExtra] = useState(0);
  const [totals, setTotals] = useState<{ cheers: number; mine: number } | null>(null);
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mine = Math.min((totals?.mine ?? me.cheers) + extra, LOTTERY_CHEERS_MAX);
  const all = (totals?.cheers ?? props.v.cheers) + extra;
  const tap = () => {
    if (mine >= LOTTERY_CHEERS_MAX || !props.base) return;
    pending.current++;
    setExtra((x) => x + 1);
    timer.current ??= setTimeout(() => {
      const n = pending.current;
      pending.current = 0;
      timer.current = null;
      api<{ cheers: number; mine: number }>(`${props.base}/lottery/cheer`, { n })
        .then((r) => {
          setTotals(r);
          setExtra((x) => Math.max(0, x - n));
        })
        .catch(() => setExtra((x) => Math.max(0, x - n)));
    }, 1000);
  };
  const open = props.v.status === "open";
  return (
    <section class="card lot-mine">
      {me.inPool ? (
        <div class="lot-mine-row">
          <span class="lot-ball">{num3(me.rank ?? 0)}</span>
          <span>
            <strong>{t("你是第 {n} 位入群的球友", { n: me.rank ?? 0 })}</strong>
            <span class="muted small">{t("抽奖号 {n} · 已在奖池里", { n: num3(me.rank ?? 0) })}</span>
          </span>
        </div>
      ) : (
        <div class="lot-mine-row">
          <span class="lot-ball later">{me.rank ?? "–"}</span>
          <span>
            <strong>{me.rank ? t("你是第 {n} 位入群的球友", { n: me.rank }) : t("你还不在这次的名单里")}</strong>
            <span class="muted small">
              {me.rank && me.rank <= props.v.poolSize
                ? t("这次你不参加抽奖")
                : t("这次抽奖是前 {n} 名入群的球友", { n: props.v.poolSize })}
            </span>
          </span>
        </div>
      )}
      {open && (
        <button
          type="button"
          class="button secondary block lot-cheer"
          onClick={tap}
          disabled={mine >= LOTTERY_CHEERS_MAX}
        >
          {t("📣 打气")} <b>{all}</b>
        </button>
      )}
      {open && mine > 0 && <p class="muted small">{t("你打了 {n} 次气，只是热闹，不影响中奖", { n: mine })}</p>}
    </section>
  );
}

function Prizes(props: { v: LotteryView }) {
  return (
    <section class="card">
      <h2>{t("奖品")}</h2>
      <ul class="lot-prizes">
        {props.v.prizes.map((p) => (
          <li key={p.name}>
            <span aria-hidden="true">🏸</span>
            <strong>{p.name}</strong>
            <span class="muted">×{p.count}</span>
          </li>
        ))}
      </ul>
      <p class="muted small">{t("按上面的顺序一个一个抽，最后的压轴。")}</p>
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

/** 公平公开: the fingerprint before, the seed after, and a check anyone can run on their own phone. */
function Fair(props: { v: LotteryView; finished: boolean }) {
  const v = props.v;
  const [check, setCheck] = useState<"ok" | "bad" | null>(null);
  const [list, setList] = useState(false);
  async function verify() {
    if (!v.seed) return;
    const hashOk = (await sha256Hex(v.seed)) === v.seedHash;
    const again = await drawWinners(
      v.seed,
      v.entries.map((e) => e.rank),
      v.draws,
    );
    setCheck(hashOk && again.join() === v.winners.map((w) => w.rank).join() ? "ok" : "bad");
  }
  return (
    <section class="card">
      <h2>{t("公平公开")}</h2>
      <p class="muted small">
        {t(
          "名单按入群通过的先后排好，公布时就锁定了。开奖用的随机数先封存，只公布它的指纹；开奖后公开随机数，谁都能自己算一遍，没人能事先挑人。",
        )}
      </p>
      <p class="lot-code">
        {t("指纹")} {v.seedHash.slice(0, 16)}…
      </p>
      {v.seed && (
        <p class="lot-code">
          {t("随机数")} {v.seed.slice(0, 16)}…
        </p>
      )}
      {props.finished && v.seed && (
        <button type="button" class="button secondary block" onClick={verify}>
          {t("在我的手机上核对一遍")}
        </button>
      )}
      {check === "ok" && <p class="lot-ok">{t("✓ 指纹对得上，算出来的中奖名单也一样")}</p>}
      {check === "bad" && <p class="error">{t("✗ 对不上，请告诉群主")}</p>}
      <button type="button" class="link-button" onClick={() => setList(true)}>
        {t("查看完整名单（{n} 人）", { n: v.entries.length })}
      </button>
      {list && (
        <Panel title={t("抽奖名单")} label={t("抽奖名单")} onClose={() => setList(false)}>
          <section class="card">
            <ol class="lot-list">
              {v.entries.map((e) => (
                <li key={e.rank}>
                  <span class="lot-no">{num3(e.rank)}</span>
                  <Avatar src={e.avatar} size={24} />
                  <span>{e.name}</span>
                </li>
              ))}
            </ol>
          </section>
        </Panel>
      )}
    </section>
  );
}
