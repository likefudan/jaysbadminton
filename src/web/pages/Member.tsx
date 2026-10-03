import { useState } from "preact/hooks";
import { checkUsername } from "../../shared/rules";
import { dollars } from "../../shared/settle";
import { formatDateZh } from "../../shared/time";
import type {
  MeResponse,
  MemberProfile,
  MyEvent,
  MyEventsResponse,
  MyHistoryEvent,
  PaymentStatus,
} from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, Load, Page, SectionTitle, useAction } from "../components";
import { CalendarLinks } from "../Calendar";
import { EventInfo } from "../events";
import { FriendsEditor } from "../FriendsEditor";
import { PaymentBox } from "../PaymentBox";
import { ProfileCard } from "../Profile";
import { RosterList } from "../Roster";
import { useApi } from "../hooks";
import { EventShareRow } from "../ShareCard";
import { MyStatsCard } from "../Stats";
import { GoogleLink } from "./Account";

/** On your own page a settled event shows where your bill stands, not the group's. */
const BILL_STATUS: Record<PaymentStatus, { cls: string; label: string }> = {
  unpaid: { cls: "finalized", label: "待付款" },
  partial: { cls: "finalized", label: "部分付款" },
  paid: { cls: "settled", label: "已付清" },
};

/** 我的活动: the events they signed up for (newest first), the ones still open to join, and 历史活动. */
export function Member(props: { token?: string }) {
  const base = `/api/m/${props.token ?? "session"}`;
  const [me] = useApi<MeResponse>(`${base}/me`);
  return (
    <Load result={me}>
      {(m) => (
        <Page
          title={`你好，${m.username}`}
          subtitle={props.token ? "请不要把这个链接转发给别人。" : "你的报名、活动和账单。"}
        >
          <MemberNav token={props.token} owner={m.isOwner} current="events" />
          {!m.active && <p class="hint">你的账号已停用，不能再报名活动。如果还有没付清的费用，可以在下面继续付款。</p>}
          <MyEvents base={base} />
        </Page>
      )}
    </Load>
  );
}

/**
 * 我的活动 ⇄ 个人信息: the same row on both pages, the current one highlighted (and 管理页 for the
 * Owner signed in with Google).
 */
function MemberNav(props: { token?: string; owner: boolean; current: "events" | "profile" }) {
  const home = props.token ? `/m/${props.token}` : "/me";
  const link = (key: "events" | "profile", href: string, label: string) => (
    <a
      class={`button secondary${props.current === key ? " on" : ""}`}
      href={href}
      aria-current={props.current === key ? "page" : undefined}
    >
      {label}
    </a>
  );
  return (
    <nav class="page-links" aria-label="我的页面">
      {!props.token && props.owner && (
        <a class="button secondary" href="/admin/google">
          管理页
        </a>
      )}
      {link("events", home, "我的活动")}
      {link("profile", `${home}/profile`, "个人信息")}
    </nav>
  );
}

/** 个人信息: statistics, profile and account settings, one tap from 我的活动 or the avatar menu. */
export function MemberProfilePage(props: { token?: string }) {
  const base = `/api/m/${props.token ?? "session"}`;
  const [me, reload] = useApi<MeResponse>(`${base}/me`);
  return (
    <Load result={me}>
      {(m) => (
        <Page title="个人信息" subtitle="你的统计、资料和账号设置。">
          <MemberNav token={props.token} owner={m.isOwner} current="profile" />
          <MyStatsCard base={base} />
          <MyProfile base={base} />
          <Rename base={base} current={m.username} onDone={reload} />
          {props.token && <GoogleLink token={props.token} />}
        </Page>
      )}
    </Load>
  );
}

function MyProfile(props: { base: string }) {
  const [res, reload] = useApi<MemberProfile>(`${props.base}/profile`);
  return (
    <Load result={res}>{(p) => <ProfileCard profile={p} base={props.base} mode="member" onChange={reload} />}</Load>
  );
}

function Rename(props: { base: string; current: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(props.current);
  const { busy, error, run, setError } = useAction();
  if (!open) {
    return (
      <button class="button secondary block" onClick={() => setOpen(true)}>
        修改用户名
      </button>
    );
  }
  async function save(e: Event) {
    e.preventDefault();
    const err = checkUsername(name);
    if (err) return setError(err);
    if (await run(() => api(`${props.base}/rename`, { username: name }))) {
      setOpen(false);
      props.onDone();
    }
  }
  return (
    <Card title="修改用户名">
      <form onSubmit={save}>
        <Field label="新用户名" value={name} onInput={setName} />
        {error && <p class="error">{error}</p>}
        <button class="button block" disabled={busy}>
          保存
        </button>
        <button class="button secondary block" type="button" onClick={() => setOpen(false)}>
          取消
        </button>
      </form>
    </Card>
  );
}

function MyEvents(props: { base: string }) {
  const [res, reload] = useApi<MyEventsResponse>(`${props.base}/events`);
  return (
    <Load result={res}>
      {(r) => {
        const mine = r.events.filter((e) => e.myFriends !== null || e.payment);
        const open = r.events.filter((e) => e.myFriends === null && !e.payment);
        return (
          <>
            <SectionTitle>我报名的活动</SectionTitle>
            {mine.length === 0 && (
              <Card>
                <Empty>{r.history.length > 0 ? "最近没有报名的活动" : "还没有报名过活动"}</Empty>
              </Card>
            )}
            {mine.map((e) => (
              <SignupCard key={e.id} base={props.base} e={e} cap={r.friendCap} onChange={reload} />
            ))}
            {open.length > 0 && (
              <>
                <SectionTitle>可以报名</SectionTitle>
                {open.map((e) => (
                  <SignupCard key={e.id} base={props.base} e={e} cap={r.friendCap} onChange={reload} />
                ))}
              </>
            )}
            {r.history.length > 0 && <History list={r.history} />}
          </>
        );
      }}
    </Load>
  );
}

/** 历史活动: over and paid up, folded away by default; newest first. */
function History(props: { list: MyHistoryEvent[] }) {
  const thisYear = new Date().getFullYear().toString();
  return (
    <Card>
      <details class="fold history">
        <summary>历史活动（{props.list.length}）</summary>
        <ul class="history-list">
          {props.list.map((h) => (
            <li key={h.id}>
              <a href={`/e/${h.code}`}>
                <span class="history-when">{formatDateZh(h.date, !h.date.startsWith(thisYear))}</span>
                <span class="history-what">
                  {h.title || h.location}
                  {h.friends > 0 && <small> · 带 {h.friends} 人</small>}
                  {!h.attended && <small class="history-absent"> · 缺席</small>}
                </span>
                <span class="history-amount">{h.amountCents === null ? "—" : `$${dollars(h.amountCents)}`}</span>
              </a>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

export function SignupCard(props: { base: string; e: MyEvent; cap: number; onChange: () => void }) {
  const e = props.e;
  const [editing, setEditing] = useState(false);
  const [friends, setFriends] = useState<string[]>(e.myFriends ?? []);
  const { busy, error, run } = useAction();
  const signedUp = e.myFriends !== null;

  async function save() {
    if (await run(() => api(`${props.base}/events/${e.id}/signup`, { friends }))) {
      setEditing(false);
      props.onChange();
    }
  }
  async function cancel() {
    if (!confirm("确定取消报名吗？")) return;
    if (await run(() => api(`${props.base}/events/${e.id}/cancel`, {}))) props.onChange();
  }

  return (
    <Card>
      <EventInfo e={e} status={e.payment ? BILL_STATUS[e.payment.status] : undefined} />
      {e.roster && e.roster.length > 0 && (
        <RosterList roster={e.roster} open={e.status === "open" || e.status === "closed"} />
      )}
      {signedUp && !editing && !e.payment && (
        <>
          <p class="ok">✓ 已报名{e.myFriends!.length > 0 && `，带 ${e.myFriends!.length} 个朋友`}</p>
          <CalendarLinks e={e} />
        </>
      )}
      {!signedUp && !e.canEdit && <p class="muted">你没有报名这次活动。</p>}
      {e.canEdit && editing && (
        <>
          <FriendsEditor friends={friends} max={props.cap} onChange={setFriends} />
          {error && <p class="error">{error}</p>}
          <button class="button block" disabled={busy} onClick={save}>
            {signedUp ? "保存修改" : "确认报名"}
          </button>
          <button class="button secondary block" disabled={busy} onClick={() => setEditing(false)}>
            返回
          </button>
        </>
      )}
      {e.canEdit && !editing && (
        <>
          {error && <p class="error">{error}</p>}
          {signedUp ? (
            <div class="inline">
              <button
                class="button secondary"
                onClick={() => {
                  setFriends(e.myFriends ?? []);
                  setEditing(true);
                }}
              >
                修改
              </button>
              <button class="button danger" disabled={busy} onClick={cancel}>
                取消报名
              </button>
            </div>
          ) : (
            <button
              class="button block"
              onClick={() => {
                setFriends([]);
                setEditing(true);
              }}
            >
              报名
            </button>
          )}
        </>
      )}
      {!e.canEdit && e.status === "closed" && signedUp && (
        <p class="muted small">报名已截止，需要修改请联系管理员。费用会在活动后公布。</p>
      )}
      {e.payment && <PaymentBox p={e.payment} />}
      <EventShareRow e={e} />
    </Card>
  );
}
