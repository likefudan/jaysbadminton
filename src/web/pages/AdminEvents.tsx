import { useEffect, useRef, useState } from "preact/hooks";
import { AI_PRICES, type PhotoUsage } from "../../shared/ai";
import { QUEUE_DEFAULT_ROUND_MIN, QUEUE_ROUND_MAX, QUEUE_ROUND_MIN } from "../../shared/courtQueue";
import { AddressInput } from "../AddressInput";
import { CourtCombo } from "../CourtCombo";
import type {
  AdminEventSummary,
  AuditEntry,
  AdminViewer,
  EventDefaults,
  EventDetail,
  MemberSummary,
  OrganizersBlock,
  GuestChoice,
  RosterEntry,
  Venue,
} from "../../shared/types";
import { BOOKED_COURTS_MAX, BOOKED_COURT_MAX } from "../../shared/types";
import { api } from "../api";
import { Card, CopyButton, Empty, Field, Load, useAction } from "../components";
import { EventInfo } from "../events";
import { type FriendSlot, FriendsEditor, fromSlots, toSlots } from "../FriendsEditor";
import { useApi } from "../hooks";
import { has } from "../organizers";
import { Billing } from "./AdminSettle";
import { t, fmtDate, fmtInstant, tk } from "../i18n";

const PAST_PAGE = 30;

export function EventsTab(props: {
  base: string;
  members: MemberSummary[];
  organizers: OrganizersBlock | null;
  viewer: AdminViewer;
}) {
  const [pastShown, setPastShown] = useState(PAST_PAGE);
  // The Owner and admins, with the 组织者 feature on, see who runs each event and can show one person's.
  const byManager = has(props.viewer, "group") && !!props.organizers;
  const [manager, setManager] = useState("");
  const path = `${props.base}/events?past=${pastShown}${byManager && manager ? `&manager=${encodeURIComponent(manager)}` : ""}`;
  const [list, reload] = useApi<{
    current: AdminEventSummary[];
    past: AdminEventSummary[];
    morePast: boolean;
    /** With `group`: everyone who has run an event. */
    managers?: { id: string; name: string }[];
  }>(path);
  const [mode, setMode] = useState<"list" | "create" | number>("list");
  const owner = props.members.find((m) => m.isOwner);
  // Past managers (organizers since revoked) can be picked too: the list names everyone who ran one.
  const current = new Set([owner?.id, ...(props.organizers?.list ?? []).map((o) => o.id)]);
  const formerManagers = list.state === "ok" ? (list.data.managers ?? []).filter((m) => !current.has(m.id)) : [];
  // Until the new filter's list arrives, show it loading rather than the previous person's events
  // (显示更早的活动 only changes past=, and keeps the list on screen meanwhile).
  const filterOf = (p: string | undefined) => new URLSearchParams(p?.split("?")[1] ?? "").get("manager") ?? "";
  const shown: typeof list =
    list.state !== "loading" && filterOf(list.path) !== filterOf(path) ? { state: "loading" } : list;

  if (mode === "create") {
    return (
      <CreateEvent
        base={props.base}
        owner={has(props.viewer, "group")}
        onDone={(id) => {
          reload();
          setMode(id ?? "list");
        }}
      />
    );
  }
  if (typeof mode === "number") {
    return (
      <EventAdmin
        base={props.base}
        id={mode}
        members={props.members}
        organizers={props.organizers}
        viewer={props.viewer}
        onBack={() => {
          reload();
          setMode("list");
        }}
      />
    );
  }
  return (
    <>
      <button type="button" class="button block" onClick={() => setMode("create")}>
        {t("＋ 新建活动")}
      </button>
      {byManager && (
        <label class="field">
          <span>{t("负责人")}</span>
          <select value={manager} onChange={(e) => setManager((e.target as HTMLSelectElement).value)}>
            <option value="">{t("所有负责人")}</option>
            {owner && <option value={owner.id}>{t("群主（{name}）", { name: owner.username })}</option>}
            {props.organizers!.list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.username}
              </option>
            ))}
            {formerManagers.map((o) => (
              <option key={o.id} value={o.id}>
                {t("{name}（已卸任）", { name: o.name })}
              </option>
            ))}
          </select>
        </label>
      )}
      <Load result={shown}>
        {(l) => (
          <>
            <Card title={t("进行中")}>
              {l.current.length === 0 && <Empty>{t("没有进行中的活动")}</Empty>}
              {l.current.map((e) => (
                <EventRow key={e.id} e={e} manager={byManager} onOpen={() => setMode(e.id)} />
              ))}
            </Card>
            {l.past.length > 0 && (
              <Card title={t("已结束")}>
                {l.past.map((e) => (
                  <EventRow key={e.id} e={e} manager={byManager} onOpen={() => setMode(e.id)} />
                ))}
                {l.morePast && (
                  <button
                    type="button"
                    class="button secondary block"
                    onClick={() => setPastShown((n) => n + PAST_PAGE)}
                  >
                    {t("显示更早的活动")}
                  </button>
                )}
              </Card>
            )}
          </>
        )}
      </Load>
    </>
  );
}

function EventRow(props: { e: AdminEventSummary; manager: boolean; onOpen: () => void }) {
  return (
    <button type="button" class="event-link" onClick={props.onOpen}>
      <EventInfo e={props.e} runBy={props.manager ? t("负责人：{name}", { name: props.e.manager.name }) : undefined} />
      <span class="chevron">›</span>
    </button>
  );
}

function CreateEvent(props: { base: string; owner: boolean; onDone: (id?: number) => void }) {
  const [defaults] = useApi<EventDefaults>(`${props.base}/events/defaults`);
  return (
    <Load result={defaults}>
      {(d) => <CreateForm base={props.base} owner={props.owner} d={d} onDone={props.onDone} />}
    </Load>
  );
}

function CreateForm(props: { base: string; owner: boolean; d: EventDefaults; onDone: (id?: number) => void }) {
  const d = props.d;
  const [date, setDate] = useState("");
  const [startTime, setStart] = useState(d.startTime);
  const [endTime, setEnd] = useState(d.endTime);
  const [location, setLocation] = useState(d.location);
  const [address, setAddress] = useState(d.address);
  const [notes, setNotes] = useState("");
  const [days, setDays] = useState(d.deadlineDays);
  const [hours, setHours] = useState(d.deadlineHours);
  const [deadlineOn, setDeadlineOn] = useState(d.deadlineOn);
  const [joinSelf, setJoinSelf] = useState(true);
  const [title, setTitle] = useState("");
  // 排队系统 goes with the hall: the remembered venue brings its setting along.
  const lastQueue = d.locations.find((v) => v.name === d.location)?.queueRoundMin ?? null;
  const [queueOn, setQueueOn] = useState(lastQueue !== null);
  const [roundMin, setRoundMin] = useState(String(lastQueue ?? QUEUE_DEFAULT_ROUND_MIN));
  const { busy, error, run } = useAction();
  const venueQueue = (min: number | null) => {
    setQueueOn(min !== null);
    setRoundMin(String(min ?? QUEUE_DEFAULT_ROUND_MIN));
  };

  async function submit(ev: Event) {
    ev.preventDefault();
    const body = {
      title,
      date,
      startTime,
      endTime,
      location,
      address,
      notes,
      queueRoundMin: queueOn ? Number(roundMin) : null,
      deadlineDays: days,
      deadlineHours: hours,
      noDeadline: !deadlineOn,
      joinSelf,
    };
    const r = await run(() => api<EventDetail>(`${props.base}/events`, body));
    if (r) props.onDone(r.id);
  }

  return (
    <Card title={t("新建活动")}>
      <form onSubmit={submit}>
        <label class={`switch-card ${joinSelf ? "on" : ""}`}>
          <span>
            <strong>{t("我自己也报名")}</strong>
            <small>{t("创建后你会直接出现在报名名单里")}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={joinSelf}
            checked={joinSelf}
            onChange={(e) => setJoinSelf((e.target as HTMLInputElement).checked)}
          />
        </label>
        <Field
          label={t("标题（选填）")}
          value={title}
          onInput={setTitle}
          hint={t("特别的活动可以起个名字，例如「HappyTuesday 比赛」；不填就只显示日期")}
        />
        <Field label={t("日期")} type="date" value={date} onInput={setDate} />
        <div class="inline">
          <Field label={t("开始")} type="time" value={startTime} onInput={setStart} />
          <Field label={t("结束")} type="time" value={endTime} onInput={setEnd} />
        </div>
        <VenueFields
          base={props.base}
          canForget={props.owner}
          venues={d.locations}
          venue={location}
          address={address}
          onVenue={setLocation}
          onAddress={setAddress}
          onQueue={venueQueue}
        />
        <NotesField value={notes} onInput={setNotes} />
        <QueueField on={queueOn} minutes={roundMin} onOn={setQueueOn} onMinutes={setRoundMin} />
        <label class={`switch-card ${deadlineOn ? "on" : ""}`}>
          <span>
            <strong>{t("报名截止时间")}</strong>
            <small>
              {deadlineOn ? t("到截止时间就不能再报名") : t("不设截止：活动结束前都能报名（Finalize 后就不能了）")}
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={deadlineOn}
            checked={deadlineOn}
            onChange={(e) => setDeadlineOn((e.target as HTMLInputElement).checked)}
          />
        </label>
        {deadlineOn && (
          <div class="field">
            <span>{t("活动开始前")}</span>
          </div>
        )}
        {deadlineOn && (
          <div class="inline">
            <label class="field">
              <select value={days} onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}>
                {Array.from({ length: 15 }, (_, i) => (
                  <option key={i} value={i}>
                    {t("{n} 天", { n: i })}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <select value={hours} onChange={(e) => setHours(Number((e.target as HTMLSelectElement).value))}>
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {t("{n} 小时", { n: i })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {error && <p class="error">{error}</p>}
        <button type="submit" class="button block" disabled={busy || !date}>
          {t("创建活动")}
        </button>
        <button class="button secondary block" type="button" onClick={() => props.onDone()}>
          {t("返回")}
        </button>
      </form>
    </Card>
  );
}

/** 排队系统: on for halls where courts are taken by queuing on the hall's computer, with the round length. */
function QueueField(props: {
  on: boolean;
  minutes: string;
  onOn: (on: boolean) => void;
  onMinutes: (v: string) => void;
}) {
  return (
    <>
      <label class={`switch-card ${props.on ? "on" : ""}`}>
        <span>
          <strong>{t("排队系统")}</strong>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={props.on}
          checked={props.on}
          onChange={(e) => props.onOn((e.target as HTMLInputElement).checked)}
        />
      </label>
      {props.on && (
        <Field
          label={t("每轮多少分钟")}
          type="number"
          value={props.minutes}
          onInput={props.onMinutes}
          hint={t("用来估算排队的组大约多久上场，{QUEUE_ROUND_MIN}–{QUEUE_ROUND_MAX} 分钟", {
            QUEUE_ROUND_MIN,
            QUEUE_ROUND_MAX,
          })}
        />
      )}
    </>
  );
}

function NotesField(props: { value: string; onInput: (value: string) => void }) {
  return (
    <label class="field">
      <span>{t("备注（选填）")}</span>
      <textarea
        rows={3}
        maxLength={1000}
        value={props.value}
        onInput={(e) => props.onInput((e.target as HTMLTextAreaElement).value)}
      />
    </label>
  );
}

/**
 * 场馆 + 地址, with one-tap 最近的场馆 that fill both and the venue's 排队系统 setting (the Owner
 * can also forget one with ✕).
 */
function VenueFields(props: {
  base: string;
  canForget?: boolean;
  venues: Venue[];
  venue: string;
  address: string;
  onVenue: (v: string) => void;
  onAddress: (v: string) => void;
  /** A recent venue was picked: set 排队系统 the way its last event had it. */
  onQueue?: (roundMin: number | null) => void;
}) {
  const [venues, setVenues] = useState(props.venues);
  const pick = (v: Venue) => {
    props.onVenue(v.name);
    props.onAddress(v.address);
    props.onQueue?.(v.queueRoundMin);
  };
  // No confirmation: it only forgets a shortcut, and typing the venue again brings it back.
  async function forget(name: string) {
    setVenues((list) => list.filter((v) => v.name !== name));
    try {
      await api(`${props.base}/locations/remove`, { name });
    } catch {
      setVenues(props.venues);
    }
  }
  return (
    <>
      {venues.length > 0 && (
        <div class="field">
          <span>{t("最近的场馆")}</span>
          <div class="chips">
            {venues.map((v) => (
              <span class="chip-wrap" key={v.name}>
                <button type="button" class={v.name === props.venue ? "chip on" : "chip"} onClick={() => pick(v)}>
                  {v.name}
                </button>
                {props.canForget && (
                  <button
                    type="button"
                    class="chip-remove"
                    aria-label={t("从最近的场馆中删除「{name}」", { name: v.name })}
                    onClick={() => forget(v.name)}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      <Field
        label={t("场馆")}
        value={props.venue}
        onInput={(v) => {
          props.onVenue(v);
          const known = props.venues.find((x) => x.name === v.trim());
          if (known) {
            props.onAddress(known.address);
            props.onQueue?.(known.queueRoundMin);
          }
        }}
      />
      <AddressInput
        base={props.base}
        value={props.address}
        onInput={props.onAddress}
        onPlace={(name) => !props.venue.trim() && props.onVenue(name)}
      />
    </>
  );
}

function EventAdmin(props: {
  base: string;
  id: number;
  members: MemberSummary[];
  organizers: OrganizersBlock | null;
  viewer: AdminViewer;
  onBack: () => void;
}) {
  const [ev, reload] = useApi<EventDetail>(`${props.base}/events/${props.id}`);
  return (
    <>
      <button type="button" class="back" onClick={props.onBack}>
        {t("‹ 所有活动")}
      </button>
      <Load result={ev}>
        {(e) => (
          <EventAdminBody
            base={props.base}
            e={e}
            members={props.members}
            organizers={props.organizers}
            viewer={props.viewer}
            onChange={reload}
            onBack={props.onBack}
          />
        )}
      </Load>
    </>
  );
}

function EventAdminBody(props: {
  base: string;
  e: EventDetail;
  members: MemberSummary[];
  organizers: OrganizersBlock | null;
  viewer: AdminViewer;
  onChange: () => void;
  onBack: () => void;
}) {
  const e = props.e;
  const isOwner = has(props.viewer, "owner");
  const owner = props.members.find((m) => m.isOwner);
  // Rows added from the admin page. With organizers, events change hands and either may have added
  // them, so the badge doesn't say who.
  const addedBy = props.organizers ? t("代为添加") : t("群主添加");
  const eb = `${props.base}/events/${e.id}`;
  const editable = e.status === "open" || e.status === "closed" || e.status === "finalized";
  const publicLink = `${location.origin}/e/${e.code}`;
  const { busy, error, run } = useAction();

  async function cancelEvent() {
    if (!confirm(t("取消后这次活动不产生费用，也不计入统计。确定取消吗？"))) return;
    if (await run(() => api(`${eb}/cancel`, {}))) props.onBack();
  }
  async function remove(r: RosterEntry) {
    if (!confirm(t("从名单中删除「{name}」？", { name: r.name }))) return;
    if (await run(() => api(`${eb}/roster/${r.id}/remove`, {}))) props.onChange();
  }
  async function toggleAttendance(r: RosterEntry) {
    if (await run(() => api(`${eb}/attendance`, { registrationId: r.id, attended: !r.attended }))) props.onChange();
  }
  async function rename(r: RosterEntry) {
    const name = prompt(t("朋友的名字（留空则显示为默认名字）"), r.name);
    if (name === null) return;
    if (await run(() => api(`${eb}/roster/${r.id}/rename`, { name }))) props.onChange();
  }

  return (
    <>
      <Card>
        <EventInfo e={e} />
        <CopyButton text={publicLink} label={t("复制活动链接")} />
      </Card>

      <MySignup
        eb={eb}
        e={e}
        members={props.members}
        me={props.members.find((m) => m.id === props.viewer.id)}
        title={props.viewer.role === "owner" ? t("群主") : props.viewer.role === "admin" ? t("管理员") : t("负责人")}
        onDone={props.onChange}
      />

      {(e.status === "open" || e.status === "closed") && <BookedCourts eb={eb} e={e} onDone={props.onChange} />}

      {e.status === "open" && <CloseNow eb={eb} onDone={props.onChange} />}
      {e.status === "closed" && <Reopen eb={eb} e={e} onDone={props.onChange} />}

      {/* Workflow order: add walk-ins, check the roster, then fill in the costs. */}
      {editable && (
        <AddPeople
          eb={eb}
          members={props.members}
          me={props.viewer.id}
          roster={e.roster}
          payee={e.payee}
          onDone={props.onChange}
        />
      )}

      <Card title={t("名单（{n}）", { n: e.roster.length })}>
        {error && <p class="error">{error}</p>}
        {e.roster.length === 0 && <Empty>{t("还没有人报名")}</Empty>}
        {e.roster.map((r) => (
          <div class="row" key={r.id}>
            <div class="who">
              {(r.friendIndex > 0 || r.paidBy) && "　↳ "}
              {r.name}
              {r.addedByOwner && <span class="badge">{addedBy}</span>}
              {r.friendIndex > 0 && <small>　{t("{name} 带的朋友", { name: r.memberName })}</small>}
              {r.paidBy && <small>　{t("{name} 带的群友，{name} 付钱", { name: r.paidByName ?? "" })}</small>}
            </div>
            {editable && (
              <div class="actions">
                {e.status !== "open" && (
                  <button
                    type="button"
                    class={`toggle ${r.attended ? "" : "off"}`}
                    disabled={busy}
                    onClick={() => toggleAttendance(r)}
                  >
                    {r.attended ? t("到场") : t("未出席")}
                  </button>
                )}
                {r.friendIndex > 0 && (
                  <button type="button" class="button secondary" disabled={busy} onClick={() => rename(r)}>
                    {t("改名")}
                  </button>
                )}
                <button type="button" class="button danger" disabled={busy} onClick={() => remove(r)}>
                  {t("删除")}
                </button>
              </div>
            )}
          </div>
        ))}
      </Card>

      {e.photoUsage && <PhotoUsageCard u={e.photoUsage} />}

      <Billing base={props.base} e={e} onChange={props.onChange} />

      {editable && <EditEvent eb={eb} e={e} onDone={props.onChange} />}

      {editable && props.organizers?.canManage && (
        <Transfer eb={eb} e={e} owner={owner} organizers={props.organizers} onDone={props.onChange} />
      )}

      {(e.status === "open" || e.status === "closed") && (
        <button type="button" class="button danger block" disabled={busy} onClick={cancelEvent}>
          {t("取消这次活动")}
        </button>
      )}

      <AuditLog eb={eb} e={e} />

      {e.deletable && isOwner && <DeleteEvent eb={eb} e={e} onDone={props.onBack} />}
    </>
  );
}

const count = (n: number) => n.toLocaleString("en-US");
const dollars = (n: number) => (n > 0 && n < 0.01 ? "< $0.01" : `$${n.toFixed(2)}`);

/**
 * 拍照登记用量 (Ke Li, 2026-11-03): photos read, tokens and an estimated price, for the Owner, admins
 * and the event's organizer to see. Only a number to know: nobody is charged for it.
 */
function PhotoUsageCard(props: { u: PhotoUsage }) {
  const u = props.u;
  const models = (cost: boolean) => [...new Set(u.rows.filter((r) => (r.cost !== null) === cost).map((r) => r.model))];
  const priced = models(true).filter((m) => AI_PRICES[m]);
  const unpriced = models(false);
  return (
    <Card title={t("拍照登记用量")}>
      <div class="usage-tiles">
        <div>
          <b>{count(u.photos)}</b>
          <span>{t("张照片")}</span>
        </div>
        <div>
          <b>{count(u.tokens)}</b>
          <span>token</span>
        </div>
        <div>
          <b>{u.cost === null ? "—" : `≈ ${dollars(u.cost)}`}</b>
          <span>{u.cost !== null && unpriced.length > 0 ? t("估价（不全）") : t("估价")}</span>
        </div>
      </div>
      {u.rows.map((r) => (
        <div class="usage-row" key={`${r.model} ${r.effort} ${r.fallback}`}>
          <span>
            {r.model} · {r.fallback ? t("备用") : r.effort}
          </span>
          <span>{t("{n} 张", { n: count(r.calls) })}</span>
          <span class="muted">{t("{input} 入 / {output} 出", { input: count(r.input), output: count(r.output) })}</span>
          <span>{r.cost === null ? "—" : dollars(r.cost)}</span>
        </div>
      ))}
      <p class="muted small">
        {u.failed > 0 && t("其中 {failed} 张识别失败（也计入用量）。", { failed: u.failed })}
        {priced.length > 0 &&
          t("按 Anthropic 公开价估算：{prices}。", {
            prices: priced
              .map((m) => {
                const p = AI_PRICES[m]!;
                return t("{name} 每百万 token 输入 {input}、输出 {output}", {
                  name: p.name,
                  input: `$${p.input}`,
                  output: `$${p.output}`,
                });
              })
              .join(t("；")),
          })}
        {unpriced.length > 0 && t("{models} 没有价格，只算了 token。", { models: unpriced.join(t("、")) })}
        {t("实际账单以 Azure 为准。")}
      </p>
    </Card>
  );
}

/** 操作记录: who changed what on this event, newest first. Loaded only once opened. */
function AuditLog(props: { eb: string; e: EventDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <details class="fold" onToggle={(ev) => setOpen((ev.currentTarget as HTMLDetailsElement).open)}>
        <summary>{t("操作记录")}</summary>
        {open && <AuditList eb={props.eb} e={props.e} />}
      </details>
    </Card>
  );
}

function AuditList(props: { eb: string; e: EventDetail }) {
  const [log, reload] = useApi<{ entries: AuditEntry[] }>(`${props.eb}/audit`);
  // The page reloads the event after every change; the log follows it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else reload();
  }, [props.e]);
  return (
    <Load result={log}>
      {({ entries }) =>
        entries.length === 0 ? (
          <Empty>{t("还没有记录")}</Empty>
        ) : (
          <ul class="audit">
            {entries.map((a) => (
              <li key={a.id}>
                <small class="muted">
                  {fmtInstant(a.at)} · {a.actor}
                </small>
                <div>{a.detail}</div>
              </li>
            ))}
          </ul>
        )
      }
    </Load>
  );
}

/** 转交 (Owner): another organizer or the Owner runs it; before Finalize the money goes with it. */
function Transfer(props: {
  eb: string;
  e: EventDetail;
  owner: MemberSummary | undefined;
  organizers: OrganizersBlock;
  onDone: () => void;
}) {
  const e = props.e;
  const choices = [
    ...(props.owner
      ? [{ id: props.owner.id, label: t("群主（{name}）", { name: props.owner.username }), ready: true }]
      : []),
    ...props.organizers.list.map((o) => ({ id: o.id, label: o.username, ready: o.paymentReady })),
  ].filter((c) => c.id !== e.manager.id);
  const [to, setTo] = useState("");
  const { busy, error, run } = useAction();
  const finalized = e.status === "finalized";
  async function submit() {
    const target = choices.find((c) => c.id === to);
    if (!target) return;
    const money = finalized
      ? t("账单已经发出，收款人仍是 {name}，只换负责人。", { name: e.payee.name })
      : t("收款人也一起换成 {label}，结算后成员把钱付给他（{payee}本人和挂在名下的朋友也要付）。", {
          label: target.label,
          payee: e.payee.name,
        }) +
        (target.ready ? "" : `\n\n${t("{label} 还没填好收款设置，填好之前这场不能结算。", { label: target.label })}`);
    if (!confirm(t("把这场活动转给 {label}？\n\n{money}", { label: target.label, money }))) return;
    if (await run(() => api(`${props.eb}/transfer`, { to }))) {
      setTo("");
      props.onDone();
    }
  }
  return (
    <Card title={t("负责人")}>
      <p>{t("负责人：{manager} · 收款人：{payee}", { manager: e.manager.name, payee: e.payee.name })}</p>
      {choices.length > 0 && (
        <>
          <label class="field">
            <span>{t("转给")}</span>
            <select value={to} onChange={(ev) => setTo((ev.target as HTMLSelectElement).value)}>
              <option value="">{t("选择一位组织者或群主")}</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <p class="muted small">
            {finalized
              ? t("已经结算：只换负责人，钱仍然付给原来的收款人，直到收齐。")
              : t("还没结算：负责人和收款人一起换。")}
          </p>
          {error && <p class="error">{error}</p>}
          <button type="button" class="button secondary block" disabled={busy || !to} onClick={submit}>
            {t("转交")}
          </button>
        </>
      )}
    </Card>
  );
}

/** 从数据库永久删除: for test events and other history. Asks for the admin password, then confirms once more. */
function DeleteEvent(props: { eb: string; e: EventDetail; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const label = `${fmtDate(props.e.date)}${props.e.title ? `「${props.e.title}」` : ""}`;

  async function submit(ev: Event) {
    ev.preventDefault();
    if (!confirm(t("最后确认：永久删除 {label} 这次活动？删除后无法恢复。", { label }))) return;
    if (await run(() => api(`${props.eb}/delete`, { password }))) props.onDone();
  }

  return (
    <Card title={t("危险操作")}>
      {!open ? (
        <>
          <p class="muted small">
            {t(
              "比如测试用的活动。只有已收齐归档或已取消的活动可以删除。删除后不再计入排行榜、成员花费和 Google Sheets 同步。",
            )}
          </p>
          <button type="button" class="button danger block" onClick={() => setOpen(true)}>
            {t("从数据库永久删除")}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p class="error">{t("这次活动的报名名单、账单、付款记录和匹配到的 Venmo 收款都会被一并删除，无法恢复。")}</p>
          <Field
            label={t("群主密码")}
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button danger block" disabled={busy || !password}>
            {t("永久删除")}
          </button>
          <button class="button secondary block" type="button" onClick={() => setOpen(false)}>
            {t("取消")}
          </button>
        </form>
      )}
    </Card>
  );
}

/**
 * 我的报名: whoever is on the admin page (the Owner, or the organizer running it) plays too, and signs
 * up here rather than through a member link. Editable until Finalize (after the deadline as well,
 * since they can change the roster anyway).
 */
function MySignup(props: {
  eb: string;
  e: EventDetail;
  members: MemberSummary[];
  me: MemberSummary | undefined;
  /** 群主 / 管理员 / 负责人: why they may still change their sign-up after it closed. */
  title: string;
  onDone: () => void;
}) {
  const { e, me } = props;
  const mine = me ? e.roster.filter((r) => r.memberId === me.id && !r.paidBy) : [];
  const signedUp = mine.some((r) => r.friendIndex === 0);
  // 带群友: the group members they bring, then friends by name.
  const myGuests = me ? e.roster.filter((r) => r.paidBy === me.id) : [];
  const myFriends = [...myGuests, ...mine.filter((r) => r.friendIndex > 0)];
  const broughtBy = me ? e.roster.find((r) => r.memberId === me.id && r.paidBy)?.paidByName : undefined;
  // Unnamed friends show as "<name>的朋友<n>"; edit them as blank again.
  const current = () =>
    toSlots(
      mine
        .filter((r) => r.friendIndex > 0)
        .map((r) =>
          // The server names them in Chinese whatever the page's language (worker/events.ts friendName).
          r.name === `${r.memberName}${tk("的朋友")}${r.friendIndex}` ? "" : r.name,
        ),
      myGuests.map((r) => ({ id: r.memberId, name: r.name })),
    );
  const [editing, setEditing] = useState(false);
  const [friends, setFriends] = useState<FriendSlot[]>(current);
  const { busy, error, run } = useAction();
  const canEdit = e.status === "open" || e.status === "closed";
  if (!me) return null;

  async function save() {
    if (await run(() => api(`${props.eb}/self-signup`, fromSlots(friends)))) {
      setEditing(false);
      props.onDone();
    }
  }
  async function cancel() {
    if (
      !confirm(
        myFriends.length ? t("取消你自己和带的 {n} 个朋友的报名？", { n: myFriends.length }) : t("取消你自己的报名？"),
      )
    )
      return;
    if (await run(() => api(`${props.eb}/self-cancel`, {}))) props.onDone();
  }

  const status = broughtBy
    ? t("✓ {broughtBy} 带你报名，费用由 {broughtBy} 付", { broughtBy })
    : signedUp
      ? myFriends.length
        ? t("✓ 你已报名，带 {n} 个朋友（{names}）", {
            n: myFriends.length,
            names: myFriends.map((r) => r.name).join(t("、")),
          })
        : t("✓ 你已报名")
      : myFriends.length
        ? t("你没有报名，但名单上有你带的 {n} 个朋友", { n: myFriends.length })
        : t("你还没有报名");

  return (
    <Card title={t("我的报名")}>
      {!editing && <p class={signedUp || broughtBy ? "ok" : "muted"}>{status}</p>}
      {canEdit && editing && (
        <>
          <FriendsEditor
            friends={friends}
            max={null}
            onChange={setFriends}
            choices={async () => guestChoices(props.members, e.roster, me.id)}
          />
          {error && <p class="error">{error}</p>}
          <button type="button" class="button block" disabled={busy} onClick={save}>
            {signedUp ? t("保存修改") : t("确认报名")}
          </button>
          <button type="button" class="button secondary block" disabled={busy} onClick={() => setEditing(false)}>
            {t("返回")}
          </button>
        </>
      )}
      {canEdit && !editing && !broughtBy && (
        <>
          {error && <p class="error">{error}</p>}
          {signedUp ? (
            <div class="inline">
              <button
                type="button"
                class="button secondary"
                onClick={() => {
                  setFriends(current());
                  setEditing(true);
                }}
              >
                {t("修改")}
              </button>
              <button type="button" class="button danger" disabled={busy} onClick={cancel}>
                {t("取消报名")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              class="button block"
              onClick={() => {
                setFriends(current());
                setEditing(true);
              }}
            >
              {t("报名")}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * 预定场地: the hall's court numbers, any time before Finalize. Pick several from the dropdown, or
 * type one and press 添加 (or Enter).
 */
function BookedCourts(props: { eb: string; e: EventDetail; onDone: () => void }) {
  const saved = props.e.courts;
  const [courts, setCourts] = useState<number[]>(saved);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction();
  // Back in step after a save (or someone else's) reloads the event.
  useEffect(() => setCourts(saved), [saved.join()]);
  const put = (list: number[]) => setCourts([...new Set(list)].sort((a, b) => a - b));
  const toggle = (n: number) => {
    setNote("");
    put(courts.includes(n) ? courts.filter((x) => x !== n) : [...courts, n]);
  };
  function addTyped() {
    const n = Number(typed.trim());
    if (!typed.trim()) return;
    if (!Number.isInteger(n) || n < 1 || n > BOOKED_COURT_MAX) {
      setNote(t("场地编号请填 1–{BOOKED_COURT_MAX}", { BOOKED_COURT_MAX }));
      return;
    }
    setNote("");
    setTyped("");
    if (!courts.includes(n)) put([...courts, n]);
  }
  const changed = courts.join() !== saved.join();
  const tooMany = courts.length > BOOKED_COURTS_MAX;
  return (
    <Card title={t("预定场地")}>
      {/* One element either way: swapping it would move the box below and close its list. */}
      <div class="chips booked-courts">
        {courts.length ? (
          courts.map((n) => (
            <span class="chip-wrap" key={n}>
              <span class="chip on">{t("{n} 号", { n })}</span>
              <button type="button" class="chip-remove" aria-label={t("去掉 {n} 号", { n })} onClick={() => toggle(n)}>
                ✕
              </button>
            </span>
          ))
        ) : (
          <span class="muted">{t("还没有填场地")}</span>
        )}
      </div>
      <div class="booked-add">
        <CourtCombo
          id="booked-court-no"
          label={t("添加场地")}
          placeholder={t("选择或输入 1–{BOOKED_COURT_MAX}", { BOOKED_COURT_MAX })}
          toggleLabel={t("选择场地")}
          value={typed}
          onInput={setTyped}
          list={BOOKED_COURT_MAX}
          max={BOOKED_COURT_MAX}
          isOn={(n) => courts.includes(n)}
          onPick={(n) => {
            setTyped("");
            toggle(n);
          }}
          multi
          onEnter={addTyped}
        />
        {typed.trim() && (
          <button type="button" class="button secondary block" onClick={addTyped}>
            {t("添加 {n} 号", { n: typed.trim() })}
          </button>
        )}
      </div>
      {note && <p class="error">{note}</p>}
      {tooMany && <p class="error">{t("最多 {n} 块场地", { n: BOOKED_COURTS_MAX })}</p>}
      {error && <p class="error">{error}</p>}
      <button
        type="button"
        class="button block"
        disabled={busy || !changed || tooMany}
        onClick={async () => {
          if (await run(() => api(`${props.eb}/courts`, { courts }))) props.onDone();
        }}
      >
        {t("保存场地")}
      </button>
    </Card>
  );
}

function Reopen(props: { eb: string; e: EventDetail; onDone: () => void }) {
  const [date, setDate] = useState(props.e.date);
  const [time, setTime] = useState(props.e.startTime);
  const { busy, error, run } = useAction();
  return (
    <Card title={t("重新开放报名")}>
      <div class="inline">
        <Field label={t("截止日期")} type="date" value={date} onInput={setDate} />
        <Field label={t("截止时间")} type="time" value={time} onInput={setTime} />
      </div>
      {error && <p class="error">{error}</p>}
      <button
        type="button"
        class="button secondary block"
        disabled={busy}
        onClick={async () => {
          if (await run(() => api(`${props.eb}/reopen`, { date, time }))) props.onDone();
        }}
      >
        {t("重新开放")}
      </button>
    </Card>
  );
}

/**
 * 选群友 on the admin page, from the member list it already has: every active member but the one
 * bringing them, and whether (and why not) they can be brought.
 */
function guestChoices(members: MemberSummary[], roster: RosterEntry[], bringer: string): GuestChoice[] {
  return members
    .filter((m) => m.status === "active" && !m.deletedAt && m.id !== bringer)
    .sort((a, b) => a.username.localeCompare(b.username, "en", { sensitivity: "base" }))
    .map((m) => {
      const own = roster.find((r) => r.memberId === m.id && r.friendIndex === 0);
      const on = roster.some((r) => r.memberId === m.id);
      return {
        id: m.id,
        name: m.username,
        state: !on ? "free" : own?.paidBy === bringer ? "mine" : own?.paidBy ? "brought" : "on",
        by: own?.paidBy && own.paidBy !== bringer ? own.paidByName : null,
      };
    });
}

function AddPeople(props: {
  eb: string;
  members: MemberSummary[];
  /** Who is adding: shown as （我） in the list. */
  me: string | null;
  roster: RosterEntry[];
  payee: EventDetail["payee"];
  onDone: () => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [includeSelf, setIncludeSelf] = useState(true);
  const [friends, setFriends] = useState<FriendSlot[]>([]);
  const { busy, error, run } = useAction();
  const onRoster = new Set(props.roster.filter((r) => r.friendIndex === 0).map((r) => r.memberId));
  const selfAvailable = memberId !== "" && !onRoster.has(memberId);
  // Brought by someone (带群友): they can't bring anyone themselves.
  const brought = props.roster.some((r) => r.memberId === memberId && r.paidBy);

  async function add() {
    const ok = await run(() =>
      api(`${props.eb}/roster/add`, { memberId, includeSelf: includeSelf && selfAvailable, ...fromSlots(friends) }),
    );
    if (ok) {
      setMemberId("");
      setFriends([]);
      setIncludeSelf(true);
      props.onDone();
    }
  }

  return (
    <Card title={t("添加人员")}>
      <label class="field">
        <span>{t("成员")}</span>
        <select
          value={memberId}
          onChange={(e) => {
            setMemberId((e.target as HTMLSelectElement).value);
            // Group members picked for someone else don't carry over to the next one.
            setFriends((f) => f.filter((s) => !s.guest));
          }}
        >
          <option value="">{t("请选择")}</option>
          {props.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.username}
              {m.id === props.me ? t("（我）") : ""}
            </option>
          ))}
        </select>
      </label>
      {selfAvailable && (
        <label class="check">
          <input
            type="checkbox"
            checked={includeSelf}
            onChange={(e) => setIncludeSelf((e.target as HTMLInputElement).checked)}
          />
          {t("这个成员本人也来")}
        </label>
      )}
      <FriendsEditor
        friends={friends}
        max={null}
        onChange={setFriends}
        label={t("挂在他名下的朋友")}
        choices={memberId && !brought ? async () => guestChoices(props.members, props.roster, memberId) : undefined}
      />
      {error && <p class="error">{error}</p>}
      <button
        type="button"
        class="button block"
        disabled={busy || !memberId || (!(includeSelf && selfAvailable) && friends.length === 0)}
        onClick={add}
      >
        {t("添加")}
      </button>
    </Card>
  );
}

function CloseNow(props: { eb: string; onDone: () => void }) {
  const { busy, error, run } = useAction();
  async function close() {
    if (!confirm(t("立即截止后，成员不能再报名或修改。之后如有需要可以重新开放。确定吗？"))) return;
    if (await run(() => api(`${props.eb}/close-now`, {}))) props.onDone();
  }
  return (
    <div class="spaced">
      {error && <p class="error">{error}</p>}
      <button type="button" class="button secondary block" disabled={busy} onClick={close}>
        {t("立即截止报名")}
      </button>
    </div>
  );
}

/** Emergency-only edit of date, times and location, folded away by default. */
function EditEvent(props: { eb: string; e: EventDetail; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(props.e.date);
  const [startTime, setStart] = useState(props.e.startTime);
  const [endTime, setEnd] = useState(props.e.endTime);
  const [location, setLocation] = useState(props.e.location);
  const [address, setAddress] = useState(props.e.address);
  const [notes, setNotes] = useState(props.e.notes ?? "");
  const [title, setTitle] = useState(props.e.title);
  const [queueOn, setQueueOn] = useState(props.e.queueRoundMin !== null);
  const [roundMin, setRoundMin] = useState(String(props.e.queueRoundMin ?? QUEUE_DEFAULT_ROUND_MIN));
  const { busy, error, run } = useAction();

  if (!open) {
    return (
      <button type="button" class="link-button" onClick={() => setOpen(true)}>
        {t("修改活动标题、时间、地点、备注或排队系统")}
      </button>
    );
  }
  async function save() {
    const msg = t(
      "修改会立即显示在活动页和成员页，但不会自动通知任何人，请自己在群里说明。活动代号和已发出的链接不变。确定修改吗？",
    );
    if (!confirm(msg)) return;
    if (
      await run(() =>
        api(`${props.eb}/edit`, {
          title,
          date,
          startTime,
          endTime,
          location,
          address,
          notes,
          queueRoundMin: queueOn ? Number(roundMin) : null,
        }),
      )
    ) {
      setOpen(false);
      props.onDone();
    }
  }
  return (
    <Card title={t("修改活动（紧急情况）")}>
      <p class="warn">{t("只在场地变更、时间临时调整等紧急情况使用。修改后请在微信群里通知大家。")}</p>
      <Field label={t("标题（选填）")} value={title} onInput={setTitle} />
      <Field label={t("日期")} type="date" value={date} onInput={setDate} />
      <div class="inline">
        <Field label={t("开始")} type="time" value={startTime} onInput={setStart} />
        <Field label={t("结束")} type="time" value={endTime} onInput={setEnd} />
      </div>
      <VenueFields
        base={props.eb.replace(/\/events\/\d+$/, "")}
        venues={[]}
        venue={location}
        address={address}
        onVenue={setLocation}
        onAddress={setAddress}
      />
      <NotesField value={notes} onInput={setNotes} />
      <QueueField on={queueOn} minutes={roundMin} onOn={setQueueOn} onMinutes={setRoundMin} />
      {error && <p class="error">{error}</p>}
      <button type="button" class="button block" disabled={busy} onClick={save}>
        {t("保存修改")}
      </button>
      <button type="button" class="button secondary block" disabled={busy} onClick={() => setOpen(false)}>
        {t("取消")}
      </button>
    </Card>
  );
}
