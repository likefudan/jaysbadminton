import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { GUEST_NAME_MAX, MATCH_GAMES_MAX, SCORE_DAYS } from "../shared/rules";
import type { Match, MatchPlayer, MyEvent, ScorePeople } from "../shared/types";
import { api } from "./api";
import { Avatar } from "./Avatar";
import { Load, useAction } from "./components";
import { useApi } from "./hooks";
import { t } from "./i18n";
import { Panel } from "./Panel";

/** A shuttlecock: the feathered skirt over the cork. */
const ShuttleIcon = () => (
  <svg class="score-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M6.5 3h11l-3.2 12.2h-4.6zM9.6 3l1.3 12.2M14.4 3l-1.3 12.2M7.6 7.5h8.8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
    />
    <path d="M9.7 15.2h4.6v1.3a2.3 2.3 0 0 1-4.6 0z" fill="currentColor" />
  </svg>
);

/** A match seen from the viewer's side: theirs on the left when they played on the other. */
function oriented(m: Match) {
  const flip = m.sides[1].some((p) => p.me);
  return {
    left: flip ? m.sides[1] : m.sides[0],
    right: flip ? m.sides[0] : m.sides[1],
    games: flip ? m.games.map(([a, b]) => [b, a] as [number, number]) : m.games,
  };
}

function Name(props: { p: MatchPlayer; win: boolean }) {
  const { p } = props;
  const label = p.id === null ? (p.name ? `${t("路人")}·${p.name}` : t("路人")) : p.me ? t("你") : p.name;
  return <span class={`score-name${p.id === null ? " guest" : ""}${props.win ? " win" : ""}`}>{label}</span>;
}

/** The match card: both sides, each game, and where it stands. */
function MatchCard(props: { m: Match; children?: ComponentChildren }) {
  const { m } = props;
  const o = oriented(m);
  const won = o.games.filter(([a, b]) => a > b).length;
  const lost = o.games.length - won;
  const waiting = m.sides.flat().filter((p) => p.id !== null && p.answer === null);
  const rejecter = m.sides.flat().find((p) => p.answer === "no");
  return (
    <li class="score-match">
      <div class="score-side">
        {o.left.map((p, i) => (
          <Name key={i} p={p} win={won > lost} />
        ))}
      </div>
      <div class="score-games">
        {o.games.map(([a, b], i) => (
          <span key={i} class={i === 0 ? "score-game first" : "score-game"}>
            {a} : {b}
          </span>
        ))}
      </div>
      <div class="score-side right">
        {o.right.map((p, i) => (
          <Name key={i} p={p} win={lost > won} />
        ))}
      </div>
      <div class="score-meta">
        <span>{m.doubles ? t("双打") : t("单打")}</span>
        <span class="score-sp" />
        {m.status === "confirmed" && <span class="score-tag ok">{t("✓ 已确认")}</span>}
        {m.status === "pending" && (
          <span class="score-tag wait">
            {t("等 {names} 确认", { names: waiting.map((p) => (p.me ? t("你") : p.name)).join("、") })}
          </span>
        )}
        {m.status === "rejected" && (
          <span class="score-tag no">
            {t("{name} 说比分不对", { name: rejecter?.me ? t("你") : (rejecter?.name ?? "") })}
          </span>
        )}
        {m.status === "expired" && <span class="score-tag no">{t("没确认，不算数")}</span>}
      </div>
      {props.children}
    </li>
  );
}

/**
 * 比分 on an event card (Ke Li 2026-11-21): matches recorded at it, the ones waiting for the viewer
 * first with 确认 / 比分不对, and 「记录比分」 while they may record one.
 */
export function ScoreRow(props: { base: string; e: MyEvent; onChange: () => void }) {
  const s = props.e.scores;
  const [form, setForm] = useState<{ redo?: Match } | null>(null);
  const { busy, error, run } = useAction();
  if (!s) return null;
  const url = `${props.base}/events/${props.e.id}/scores`;
  const act = async (path: string, body: unknown) => {
    if ((await run(() => api(`${url}/${path}`, body))) !== undefined) props.onChange();
  };
  const ask = s.matches.filter((m) => m.toAnswer);
  const rest = s.matches.filter((m) => !m.toAnswer);
  return (
    <div class="score-foot">
      <div class="score-head">
        <ShuttleIcon />
        <span>{t("比分")}</span>
        <span class="score-sp" />
        {s.open && (
          <button type="button" class="button secondary" onClick={() => setForm({})}>
            {t("记录比分")}
          </button>
        )}
      </div>
      {error && <p class="error">{error}</p>}
      {ask.length > 0 && (
        <ul class="score-list">
          {ask.map((m) => (
            <MatchCard key={m.id} m={m}>
              <div class="score-ask">
                <p>{t("{name} 记录了这场，等你确认", { name: m.recorder })}</p>
                <div class="score-btns">
                  <button
                    type="button"
                    class="button"
                    disabled={busy}
                    onClick={() => act(`${m.id}/answer`, { ok: true })}
                  >
                    {t("确认")}
                  </button>
                  <button
                    type="button"
                    class="button secondary"
                    disabled={busy}
                    onClick={() => act(`${m.id}/answer`, { ok: false })}
                  >
                    {t("比分不对")}
                  </button>
                </div>
              </div>
            </MatchCard>
          ))}
        </ul>
      )}
      {rest.length > 0 ? (
        <ul class="score-list">
          {rest.map((m) => (
            <MatchCard key={m.id} m={m}>
              {m.mine && m.status !== "confirmed" && (
                <div class="score-mine">
                  {s.open && m.status !== "pending" && (
                    <button type="button" class="link-button" onClick={() => setForm({ redo: m })}>
                      {t("改了重新提交")}
                    </button>
                  )}
                  <button
                    type="button"
                    class="link-button score-del"
                    disabled={busy}
                    onClick={() => act(`${m.id}/delete`, {})}
                  >
                    {t("删除")}
                  </button>
                </div>
              )}
            </MatchCard>
          ))}
        </ul>
      ) : (
        ask.length === 0 && <p class="muted small score-empty">{t("还没有比分。场上的群友都确认后才算数。")}</p>
      )}
      {form && (
        <RecordPanel
          base={props.base}
          eventId={props.e.id}
          redo={form.redo}
          onClose={(saved) => {
            setForm(null);
            if (saved) props.onChange();
          }}
        />
      )}
    </div>
  );
}

/** A picked player: a member, or a 路人 with a name that may stay empty. */
type Seat = { id: string; name: string } | { guest: string } | null;
type SlotKey = "partner" | "opp0" | "opp1";

function RecordPanel(props: { base: string; eventId: number; redo?: Match; onClose: (saved: boolean) => void }) {
  const [res] = useApi<ScorePeople>(`${props.base}/events/${props.eventId}/scores/people`);
  return (
    <Panel title={t("记录比分")} label={t("记录比分")} onClose={() => props.onClose(false)}>
      <Load result={res}>{(d) => <RecordForm {...props} people={d.people} onSaved={() => props.onClose(true)} />}</Load>
    </Panel>
  );
}

const seatOf = (p: MatchPlayer | undefined): Seat =>
  !p ? null : p.id === null ? { guest: p.name } : { id: p.id, name: p.name };

function RecordForm(props: {
  base: string;
  eventId: number;
  redo?: Match;
  people: ScorePeople["people"];
  onSaved: () => void;
}) {
  const r = props.redo;
  const [doubles, setDoubles] = useState(r ? r.doubles : true);
  const [seats, setSeats] = useState<Record<SlotKey, Seat>>({
    partner: seatOf(r?.sides[0][1]),
    opp0: seatOf(r?.sides[1][0]),
    opp1: seatOf(r?.sides[1][1]),
  });
  const [active, setActive] = useState<SlotKey | null>(r ? null : doubles ? "partner" : "opp0");
  const [games, setGames] = useState<[string, string][]>(
    r ? r.games.map(([a, b]) => [String(a), String(b)]) : [["", ""]],
  );
  const { busy, error, run, setError } = useAction();
  const keys: SlotKey[] = doubles ? ["partner", "opp0", "opp1"] : ["opp0"];
  const used = new Set(keys.flatMap((k) => (seats[k] && "id" in seats[k]! ? [(seats[k] as { id: string }).id] : [])));

  const put = (seat: Seat) => {
    if (!active) return;
    const next = { ...seats, [active]: seat };
    setSeats(next);
    setActive(keys.find((k) => !next[k]) ?? null);
  };
  const tapSlot = (k: SlotKey) => {
    setSeats({ ...seats, [k]: null });
    setActive(k);
  };
  const setMode = (d: boolean) => {
    setDoubles(d);
    setActive(
      (d ? (["partner", "opp0", "opp1"] as SlotKey[]) : (["opp0"] as SlotKey[])).find((k) => !seats[k]) ?? null,
    );
  };

  const slot = (k: SlotKey) => {
    const s = seats[k];
    if (!s)
      return (
        <button
          type="button"
          key={k}
          class={`score-slot empty${active === k ? " active" : ""}`}
          onClick={() => setActive(k)}
        >
          {t("＋ 选人")}
        </button>
      );
    if ("guest" in s)
      return (
        <span key={k} class="score-slot guest">
          <input
            type="text"
            value={s.guest}
            maxLength={GUEST_NAME_MAX}
            placeholder={t("路人（名字可不填）")}
            aria-label={t("路人的名字")}
            onInput={(ev) => setSeats({ ...seats, [k]: { guest: (ev.target as HTMLInputElement).value } })}
          />
          <button type="button" class="score-x" aria-label={t("换人")} onClick={() => tapSlot(k)}>
            ×
          </button>
        </span>
      );
    return (
      <button type="button" key={k} class="score-slot" onClick={() => tapSlot(k)} aria-label={t("换人")}>
        <Avatar src={props.people.find((p) => p.id === s.id)?.avatar ?? null} size={26} />
        {s.name}
        <span class="score-x" aria-hidden="true">
          ×
        </span>
      </button>
    );
  };

  const picker = active && (
    <div class="score-pick">
      {props.people.map((p) => (
        <button type="button" key={p.id} disabled={used.has(p.id)} onClick={() => put({ id: p.id, name: p.name })}>
          {p.name}
        </button>
      ))}
      <button type="button" class="guest" onClick={() => put({ guest: "" })}>
        {t("＋ 路人")}
      </button>
    </div>
  );

  const toPlayer = (s: Seat) => (!s ? null : "id" in s ? { id: s.id } : { guest: s.guest });
  const others = keys.map((k) => seats[k]).filter((s) => s && "id" in s) as { name: string }[];

  async function save() {
    if (keys.some((k) => !seats[k])) return setError(t("请选好双方的人"));
    const parsed = games.filter(([a, b]) => a.trim() !== "" || b.trim() !== "").map(([a, b]) => [Number(a), Number(b)]);
    const ok = await run(() =>
      api(`${props.base}/events/${props.eventId}/scores`, {
        doubles,
        partner: doubles ? toPlayer(seats.partner) : undefined,
        opponents: (doubles ? [seats.opp0, seats.opp1] : [seats.opp0]).map(toPlayer),
        games: parsed,
        replaces: r?.id,
      }),
    );
    if (ok !== undefined) props.onSaved();
  }

  return (
    <div class="score-form">
      <div class="seg" role="group" aria-label={t("单打还是双打")}>
        <button type="button" class={doubles ? "" : "on"} aria-pressed={!doubles} onClick={() => setMode(false)}>
          {t("单打")}
        </button>
        <button type="button" class={doubles ? "on" : ""} aria-pressed={doubles} onClick={() => setMode(true)}>
          {t("双打")}
        </button>
      </div>
      <section class="score-team">
        <h4>{t("我方")}</h4>
        <div class="score-slots">
          <span class="score-slot me">{t("你")}</span>
          {doubles && slot("partner")}
        </div>
        {active === "partner" && picker}
      </section>
      <section class="score-team">
        <h4>{t("对方")}</h4>
        <div class="score-slots">
          {slot("opp0")}
          {doubles && slot("opp1")}
        </div>
        {(active === "opp0" || active === "opp1") && picker}
        <p class="muted small">{t("只能选这场来打球的人。对方至少要有一位群友。")}</p>
      </section>
      <section>
        <h4 class="score-label">{t("比分（我方在前）")}</h4>
        <div class="score-inputs">
          {games.map(([a, b], i) => (
            <div class="score-input" key={i}>
              <span>{t("第 {n} 局", { n: i + 1 })}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                value={a}
                aria-label={t("第 {n} 局我方", { n: i + 1 })}
                onInput={(ev) =>
                  setGames(games.map((g, j) => (j === i ? [(ev.target as HTMLInputElement).value, g[1]] : g)))
                }
              />
              <b>:</b>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                value={b}
                aria-label={t("第 {n} 局对方", { n: i + 1 })}
                onInput={(ev) =>
                  setGames(games.map((g, j) => (j === i ? [g[0], (ev.target as HTMLInputElement).value] : g)))
                }
              />
            </div>
          ))}
        </div>
        <div class="score-more">
          {games.length < MATCH_GAMES_MAX && (
            <button type="button" class="link-button" onClick={() => setGames([...games, ["", ""]])}>
              {t("＋ 再加一局")}
            </button>
          )}
          {games.length > 1 && (
            <button type="button" class="link-button" onClick={() => setGames(games.slice(0, -1))}>
              {t("去掉最后一局")}
            </button>
          )}
        </div>
      </section>
      <p class="muted small">
        {others.length > 0
          ? t("保存后推送给 {names} 确认，都确认了才算数；{n} 天内没确认就作废。", {
              names: others.map((o) => o.name).join("、"),
              n: SCORE_DAYS,
            })
          : t("场上的群友都确认了才算数；{n} 天内没确认就作废。", { n: SCORE_DAYS })}
      </p>
      {error && <p class="error">{error}</p>}
      <button type="button" class="button score-save" disabled={busy} onClick={save}>
        {t("保存")}
      </button>
    </div>
  );
}
