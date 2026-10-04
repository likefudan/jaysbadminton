import { useState } from "preact/hooks";
import { AddressInput } from "../AddressInput";
import type {
  EventDefaults,
  EventDetail,
  EventSummary,
  MemberSummary,
  OrganizersBlock,
  RosterEntry,
} from "../../shared/types";
import { formatDateZh } from "../../shared/time";
import { api } from "../api";
import { Card, CopyButton, Empty, Field, Load, useAction } from "../components";
import { EventInfo } from "../events";
import { FriendsEditor } from "../FriendsEditor";
import { useApi } from "../hooks";
import { Billing } from "./AdminSettle";

const PAST_PAGE = 30;

export function EventsTab(props: { base: string; members: MemberSummary[]; organizers: OrganizersBlock | null }) {
  const [pastShown, setPastShown] = useState(PAST_PAGE);
  const [list, reload] = useApi<{ current: EventSummary[]; past: EventSummary[]; morePast: boolean }>(
    `${props.base}/events?past=${pastShown}`,
  );
  const [mode, setMode] = useState<"list" | "create" | number>("list");

  if (mode === "create") {
    return (
      <CreateEvent
        base={props.base}
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
        ＋ 新建活动
      </button>
      <Load result={list}>
        {(l) => (
          <>
            <Card title="进行中">
              {l.current.length === 0 && <Empty>没有进行中的活动</Empty>}
              {l.current.map((e) => (
                <EventRow key={e.id} e={e} onOpen={() => setMode(e.id)} />
              ))}
            </Card>
            {l.past.length > 0 && (
              <Card title="已结束">
                {l.past.map((e) => (
                  <EventRow key={e.id} e={e} onOpen={() => setMode(e.id)} />
                ))}
                {l.morePast && (
                  <button
                    type="button"
                    class="button secondary block"
                    onClick={() => setPastShown((n) => n + PAST_PAGE)}
                  >
                    显示更早的活动
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

function EventRow(props: { e: EventSummary; onOpen: () => void }) {
  return (
    <button type="button" class="event-link" onClick={props.onOpen}>
      <EventInfo e={props.e} />
      <span class="chevron">›</span>
    </button>
  );
}

function CreateEvent(props: { base: string; onDone: (id?: number) => void }) {
  const [defaults] = useApi<EventDefaults>(`${props.base}/events/defaults`);
  return <Load result={defaults}>{(d) => <CreateForm base={props.base} d={d} onDone={props.onDone} />}</Load>;
}

function CreateForm(props: { base: string; d: EventDefaults; onDone: (id?: number) => void }) {
  const d = props.d;
  const [date, setDate] = useState("");
  const [startTime, setStart] = useState(d.startTime);
  const [endTime, setEnd] = useState(d.endTime);
  const [location, setLocation] = useState(d.location);
  const [address, setAddress] = useState(d.address);
  const [days, setDays] = useState(d.deadlineDays);
  const [hours, setHours] = useState(d.deadlineHours);
  const [joinSelf, setJoinSelf] = useState(true);
  const [title, setTitle] = useState("");
  const { busy, error, run } = useAction();

  async function submit(ev: Event) {
    ev.preventDefault();
    const body = {
      title,
      date,
      startTime,
      endTime,
      location,
      address,
      deadlineDays: days,
      deadlineHours: hours,
      joinSelf,
    };
    const r = await run(() => api<EventDetail>(`${props.base}/events`, body));
    if (r) props.onDone(r.id);
  }

  return (
    <Card title="新建活动">
      <form onSubmit={submit}>
        <label class={`switch-card ${joinSelf ? "on" : ""}`}>
          <span>
            <strong>我自己也报名</strong>
            <small>创建后你会直接出现在报名名单里</small>
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
          label="标题（选填）"
          value={title}
          onInput={setTitle}
          hint="特别的活动可以起个名字，例如「HappyTuesday 比赛」；不填就只显示日期"
        />
        <Field label="日期" type="date" value={date} onInput={setDate} />
        <div class="inline">
          <Field label="开始" type="time" value={startTime} onInput={setStart} />
          <Field label="结束" type="time" value={endTime} onInput={setEnd} />
        </div>
        <VenueFields
          base={props.base}
          venues={d.locations}
          venue={location}
          address={address}
          onVenue={setLocation}
          onAddress={setAddress}
        />
        <div class="field">
          <span>报名截止：活动开始前</span>
        </div>
        <div class="inline">
          <label class="field">
            <select value={days} onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}>
              {Array.from({ length: 15 }, (_, i) => (
                <option key={i} value={i}>
                  {i} 天
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <select value={hours} onChange={(e) => setHours(Number((e.target as HTMLSelectElement).value))}>
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {i} 小时
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p class="error">{error}</p>}
        <button type="submit" class="button block" disabled={busy || !date}>
          创建活动
        </button>
        <button class="button secondary block" type="button" onClick={() => props.onDone()}>
          返回
        </button>
      </form>
    </Card>
  );
}

/** 场馆 + 地址, with one-tap 最近的场馆 that fill both. */
function VenueFields(props: {
  base: string;
  venues: { name: string; address: string }[];
  venue: string;
  address: string;
  onVenue: (v: string) => void;
  onAddress: (v: string) => void;
}) {
  const [venues, setVenues] = useState(props.venues);
  const pick = (v: { name: string; address: string }) => {
    props.onVenue(v.name);
    props.onAddress(v.address);
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
          <span>最近的场馆</span>
          <div class="chips">
            {venues.map((v) => (
              <span class="chip-wrap" key={v.name}>
                <button type="button" class={v.name === props.venue ? "chip on" : "chip"} onClick={() => pick(v)}>
                  {v.name}
                </button>
                <button
                  type="button"
                  class="chip-remove"
                  aria-label={`从最近的场馆中删除「${v.name}」`}
                  onClick={() => forget(v.name)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <Field
        label="场馆"
        value={props.venue}
        onInput={(v) => {
          props.onVenue(v);
          const known = props.venues.find((x) => x.name === v.trim());
          if (known) props.onAddress(known.address);
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
  onBack: () => void;
}) {
  const [ev, reload] = useApi<EventDetail>(`${props.base}/events/${props.id}`);
  return (
    <>
      <button type="button" class="back" onClick={props.onBack}>
        ‹ 所有活动
      </button>
      <Load result={ev}>
        {(e) => (
          <EventAdminBody
            base={props.base}
            e={e}
            members={props.members}
            organizers={props.organizers}
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
  onChange: () => void;
  onBack: () => void;
}) {
  const e = props.e;
  const eb = `${props.base}/events/${e.id}`;
  const editable = e.status === "open" || e.status === "closed" || e.status === "finalized";
  const publicLink = `${location.origin}/e/${e.code}`;
  const { busy, error, run } = useAction();

  async function cancelEvent() {
    if (!confirm("取消后这次活动不产生费用，也不计入统计。确定取消吗？")) return;
    if (await run(() => api(`${eb}/cancel`, {}))) props.onBack();
  }
  async function remove(r: RosterEntry) {
    if (!confirm(`从名单中删除「${r.name}」？`)) return;
    if (await run(() => api(`${eb}/roster/${r.id}/remove`, {}))) props.onChange();
  }
  async function toggleAttendance(r: RosterEntry) {
    if (await run(() => api(`${eb}/attendance`, { registrationId: r.id, attended: !r.attended }))) props.onChange();
  }
  async function rename(r: RosterEntry) {
    const name = prompt("朋友的名字（留空则显示为默认名字）", r.name);
    if (name === null) return;
    if (await run(() => api(`${eb}/roster/${r.id}/rename`, { name }))) props.onChange();
  }

  return (
    <>
      <Card>
        <EventInfo e={e} />
        <p class="muted small">公开活动页（发到微信群）：</p>
        <code class="link">{publicLink}</code>
        <CopyButton text={publicLink} label="复制活动链接" />
      </Card>

      <MySignup eb={eb} e={e} owner={props.members.find((m) => m.isOwner)} onDone={props.onChange} />

      {e.status === "open" && <CloseNow eb={eb} onDone={props.onChange} />}
      {e.status === "closed" && <Reopen eb={eb} e={e} onDone={props.onChange} />}

      {/* Workflow order: add walk-ins, check the roster, then fill in the costs. */}
      {editable && (
        <AddPeople eb={eb} members={props.members} roster={e.roster} payee={e.payee} onDone={props.onChange} />
      )}

      <Card title={`名单（${e.roster.length}）`}>
        {error && <p class="error">{error}</p>}
        {e.roster.length === 0 && <Empty>还没有人报名</Empty>}
        {e.roster.map((r) => (
          <div class="row" key={r.id}>
            <div class="who">
              {r.friendIndex > 0 && "　↳ "}
              {r.name}
              {r.addedByOwner && <span class="badge">群主添加</span>}
              {r.friendIndex > 0 && <small>　{r.memberName} 带的朋友</small>}
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
                    {r.attended ? "到场" : "未出席"}
                  </button>
                )}
                {r.friendIndex > 0 && (
                  <button type="button" class="button secondary" disabled={busy} onClick={() => rename(r)}>
                    改名
                  </button>
                )}
                <button type="button" class="button danger" disabled={busy} onClick={() => remove(r)}>
                  删除
                </button>
              </div>
            )}
          </div>
        ))}
      </Card>

      <Billing base={props.base} e={e} onChange={props.onChange} />

      {editable && <EditEvent eb={eb} e={e} onDone={props.onChange} />}

      {editable && props.organizers?.canManage && (
        <Transfer
          eb={eb}
          e={e}
          owner={props.members.find((m) => m.isOwner)}
          organizers={props.organizers}
          onDone={props.onChange}
        />
      )}

      {(e.status === "open" || e.status === "closed") && (
        <button type="button" class="button danger block" disabled={busy} onClick={cancelEvent}>
          取消这次活动
        </button>
      )}

      {e.deletable && <DeleteEvent eb={eb} e={e} onDone={props.onBack} />}
    </>
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
    ...(props.owner ? [{ id: props.owner.id, label: `群主（${props.owner.username}）` }] : []),
    ...props.organizers.list.map((o) => ({ id: o.id, label: o.username })),
  ].filter((c) => c.id !== e.manager.id);
  const [to, setTo] = useState("");
  const { busy, error, run } = useAction();
  const finalized = e.status === "finalized";
  async function submit() {
    const target = choices.find((c) => c.id === to);
    if (!target) return;
    const money = finalized
      ? `账单已经发出，收款人仍是 ${e.payee.name}，只换负责人。`
      : `收款人也一起换成 ${target.label}，结算后成员把钱付给他。`;
    if (!confirm(`把这场活动转给 ${target.label}？\n\n${money}`)) return;
    if (await run(() => api(`${props.eb}/transfer`, { to }))) {
      setTo("");
      props.onDone();
    }
  }
  return (
    <Card title="负责人">
      <p>
        负责人：{e.manager.name} · 收款人：{e.payee.name}
      </p>
      {choices.length === 0 ? (
        <p class="muted small">没有可以转给的人。先在「成员」里设一位组织者。</p>
      ) : (
        <>
          <label class="field">
            <span>转给</span>
            <select value={to} onChange={(ev) => setTo((ev.target as HTMLSelectElement).value)}>
              <option value="">选择一位组织者或群主</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <p class="muted small">
            {finalized
              ? "已经结算：只换负责人，钱仍然付给原来的收款人，直到收齐。"
              : "还没结算：负责人和收款人一起换。"}
          </p>
          {error && <p class="error">{error}</p>}
          <button type="button" class="button secondary block" disabled={busy || !to} onClick={submit}>
            转交
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
  const label = `${formatDateZh(props.e.date)}${props.e.title ? `「${props.e.title}」` : ""}`;

  async function submit(ev: Event) {
    ev.preventDefault();
    if (!confirm(`最后确认：永久删除 ${label} 这次活动？删除后无法恢复。`)) return;
    if (await run(() => api(`${props.eb}/delete`, { password }))) props.onDone();
  }

  return (
    <Card title="危险操作">
      {!open ? (
        <>
          <p class="muted small">
            比如测试用的活动。只有已收齐归档或已取消的活动可以删除。删除后不再计入排行榜、成员花费和 Google Sheets
            同步。
          </p>
          <button type="button" class="button danger block" onClick={() => setOpen(true)}>
            从数据库永久删除
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p class="error">这次活动的报名名单、账单、付款记录和匹配到的 Venmo 收款都会被一并删除，无法恢复。</p>
          <Field
            label="群主密码"
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button danger block" disabled={busy || !password}>
            永久删除
          </button>
          <button class="button secondary block" type="button" onClick={() => setOpen(false)}>
            取消
          </button>
        </form>
      )}
    </Card>
  );
}

/**
 * 我的报名: the Owner plays too, and signs up here rather than through a member link. Editable
 * until Finalize (after the deadline as well, since the Owner can change the roster anyway).
 */
function MySignup(props: { eb: string; e: EventDetail; owner: MemberSummary | undefined; onDone: () => void }) {
  const { e, owner } = props;
  const mine = owner ? e.roster.filter((r) => r.memberId === owner.id) : [];
  const signedUp = mine.some((r) => r.friendIndex === 0);
  const myFriends = mine.filter((r) => r.friendIndex > 0);
  // Unnamed friends show as "<name>的朋友<n>"; edit them as blank again.
  const current = () => myFriends.map((r) => (r.name === `${r.memberName}的朋友${r.friendIndex}` ? "" : r.name));
  const [editing, setEditing] = useState(false);
  const [friends, setFriends] = useState<string[]>(current);
  const { busy, error, run } = useAction();
  const canEdit = e.status === "open" || e.status === "closed";
  if (!owner) return null;

  async function save() {
    if (await run(() => api(`${props.eb}/self-signup`, { friends }))) {
      setEditing(false);
      props.onDone();
    }
  }
  async function cancel() {
    if (!confirm(myFriends.length ? `取消你自己和带的 ${myFriends.length} 个朋友的报名？` : "取消你自己的报名？"))
      return;
    if (await run(() => api(`${props.eb}/self-cancel`, {}))) props.onDone();
  }

  const status = signedUp
    ? `✓ 你已报名${myFriends.length ? `，带 ${myFriends.length} 个朋友（${myFriends.map((r) => r.name).join("、")}）` : ""}`
    : myFriends.length
      ? `你没有报名，但名单上有你带的 ${myFriends.length} 个朋友`
      : "你还没有报名";

  return (
    <Card title="我的报名">
      {!editing && <p class={signedUp ? "ok" : "muted"}>{status}</p>}
      {canEdit && editing && (
        <>
          <FriendsEditor friends={friends} max={null} onChange={setFriends} />
          {error && <p class="error">{error}</p>}
          <button type="button" class="button block" disabled={busy} onClick={save}>
            {signedUp ? "保存修改" : "确认报名"}
          </button>
          <button type="button" class="button secondary block" disabled={busy} onClick={() => setEditing(false)}>
            返回
          </button>
        </>
      )}
      {canEdit && !editing && (
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
                修改
              </button>
              <button type="button" class="button danger" disabled={busy} onClick={cancel}>
                取消报名
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
              报名
            </button>
          )}
          {e.status === "closed" && <p class="muted small">报名已截止，你作为群主仍可以修改自己的报名，直到结算。</p>}
        </>
      )}
    </Card>
  );
}

function Reopen(props: { eb: string; e: EventDetail; onDone: () => void }) {
  const [date, setDate] = useState(props.e.date);
  const [time, setTime] = useState(props.e.startTime);
  const { busy, error, run } = useAction();
  return (
    <Card title="重新开放报名">
      <p class="muted small">
        新的截止时间最晚可以到活动结束（{formatDateZh(props.e.date)} {props.e.endTime}）。
      </p>
      <div class="inline">
        <Field label="截止日期" type="date" value={date} onInput={setDate} />
        <Field label="截止时间" type="time" value={time} onInput={setTime} />
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
        重新开放
      </button>
    </Card>
  );
}

function AddPeople(props: {
  eb: string;
  members: MemberSummary[];
  roster: RosterEntry[];
  payee: EventDetail["payee"];
  onDone: () => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [includeSelf, setIncludeSelf] = useState(true);
  const [friends, setFriends] = useState<string[]>([]);
  const { busy, error, run } = useAction();
  const onRoster = new Set(props.roster.filter((r) => r.friendIndex === 0).map((r) => r.memberId));
  const selfAvailable = memberId !== "" && !onRoster.has(memberId);

  async function add() {
    const ok = await run(() =>
      api(`${props.eb}/roster/add`, { memberId, includeSelf: includeSelf && selfAvailable, friends }),
    );
    if (ok) {
      setMemberId("");
      setFriends([]);
      setIncludeSelf(true);
      props.onDone();
    }
  }

  return (
    <Card title="添加人员">
      <p class="muted small">
        临时来的非成员，请作为「朋友」挂在{props.payee.isMe ? "你自己" : `本场收款人 ${props.payee.name} `}
        或某个成员名下，费用由这个人承担。
      </p>
      <label class="field">
        <span>成员</span>
        <select value={memberId} onChange={(e) => setMemberId((e.target as HTMLSelectElement).value)}>
          <option value="">请选择</option>
          {props.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.username}
              {m.isOwner ? "（我）" : ""}
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
          这个成员本人也来
        </label>
      )}
      <FriendsEditor friends={friends} max={null} onChange={setFriends} label="挂在他名下的朋友" />
      {error && <p class="error">{error}</p>}
      <button
        type="button"
        class="button block"
        disabled={busy || !memberId || (!(includeSelf && selfAvailable) && friends.length === 0)}
        onClick={add}
      >
        添加
      </button>
    </Card>
  );
}

function CloseNow(props: { eb: string; onDone: () => void }) {
  const { busy, error, run } = useAction();
  async function close() {
    if (!confirm("立即截止后，成员不能再报名或修改。之后如有需要可以重新开放。确定吗？")) return;
    if (await run(() => api(`${props.eb}/close-now`, {}))) props.onDone();
  }
  return (
    <div class="spaced">
      {error && <p class="error">{error}</p>}
      <button type="button" class="button secondary block" disabled={busy} onClick={close}>
        立即截止报名
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
  const [title, setTitle] = useState(props.e.title);
  const { busy, error, run } = useAction();

  if (!open) {
    return (
      <button type="button" class="link-button" onClick={() => setOpen(true)}>
        修改活动标题、时间或地点（仅限紧急情况）
      </button>
    );
  }
  async function save() {
    const msg =
      "修改会立即显示在活动页和成员页，但不会自动通知任何人，请自己在群里说明。活动代号和已发出的链接不变。确定修改吗？";
    if (!confirm(msg)) return;
    if (await run(() => api(`${props.eb}/edit`, { title, date, startTime, endTime, location, address }))) {
      setOpen(false);
      props.onDone();
    }
  }
  return (
    <Card title="修改活动（紧急情况）">
      <p class="warn">只在场地变更、时间临时调整等紧急情况使用。修改后请在微信群里通知大家。</p>
      <Field label="标题（选填）" value={title} onInput={setTitle} />
      <Field label="日期" type="date" value={date} onInput={setDate} />
      <div class="inline">
        <Field label="开始" type="time" value={startTime} onInput={setStart} />
        <Field label="结束" type="time" value={endTime} onInput={setEnd} />
      </div>
      <VenueFields
        base={props.eb.replace(/\/events\/\d+$/, "")}
        venues={[]}
        venue={location}
        address={address}
        onVenue={setLocation}
        onAddress={setAddress}
      />
      {props.e.status === "open" && (
        <p class="muted small">
          报名截止时间会跟着开始时间一起移动（间隔不变），但不晚于活动结束；如果已经过了，报名会立即截止。只改标题或地点不影响截止时间。
        </p>
      )}
      {error && <p class="error">{error}</p>}
      <button type="button" class="button block" disabled={busy} onClick={save}>
        保存修改
      </button>
      <button type="button" class="button secondary block" disabled={busy} onClick={() => setOpen(false)}>
        取消
      </button>
    </Card>
  );
}
