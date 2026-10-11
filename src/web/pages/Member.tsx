import { useState } from "preact/hooks";
import { checkUsername } from "../../shared/rules";
import { dollars } from "../../shared/settle";
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
import { EventInfo } from "../events";
import { FriendsEditor } from "../FriendsEditor";
import { PaymentBox } from "../PaymentBox";
import { ProfileCard } from "../Profile";
import { RosterList } from "../Roster";
import { useApi } from "../hooks";
import { EventActions } from "../ShareCard";
import { MyStatsCard } from "../Stats";
import { InstallCard, InstallPrompt } from "../Install";
import { PushCard, PushPrompt } from "../Push";
import { GoogleLink } from "./Account";
import { fmtDate, t, tk } from "../i18n";

/** On your own page a settled event shows where your bill stands, not the group's. */
const BILL_STATUS: Record<PaymentStatus, { cls: string; label: string }> = {
  unpaid: { cls: "finalized", label: tk("待付款") },
  partial: { cls: "finalized", label: tk("部分付款") },
  paid: { cls: "settled", label: tk("已付清") },
};

/** 我的活动: the events they signed up for (newest first), the ones still open to join, and 历史活动. */
export function Member(props: { token?: string }) {
  const base = `/api/m/${props.token ?? "session"}`;
  const [me] = useApi<MeResponse>(`${base}/me`);
  // One offer at a time: adding to the home screen first (iPhone needs it before push).
  const [installShown, setInstallShown] = useState(false);
  return (
    <Load result={me}>
      {(m) => (
        <Page
          title={t("你好，{name}", { name: m.username })}
          subtitle={props.token ? t("请不要把这个链接转发给别人。") : t("你的报名、活动和账单。")}
        >
          <MemberNav token={props.token} admin={m.canAdmin} current="events" />
          {!m.active && (
            <p class="hint">{t("你的账号已停用，不能再报名活动。如果还有没付清的费用，可以在下面继续付款。")}</p>
          )}
          <InstallPrompt onShown={setInstallShown} />
          {m.active && !installShown && (
            <PushPrompt base={base} home={props.token ? `/m/${props.token}` : "/me"} memberId={m.id} />
          )}
          <MyEvents base={base} />
        </Page>
      )}
    </Load>
  );
}

/**
 * 我的活动 ⇄ 个人信息: the same row on both pages, the current one highlighted (and 管理页 for the
 * Owner or an organizer signed in with Google).
 */
function MemberNav(props: { token?: string; admin: boolean; current: "events" | "profile" }) {
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
    <nav class="page-links" aria-label={t("我的页面")}>
      {!props.token && props.admin && (
        <a class="button secondary" href="/admin/google">
          {t("管理页")}
        </a>
      )}
      {link("events", home, t("我的活动"))}
      {link("profile", `${home}/profile`, t("个人信息"))}
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
        <Page title={t("个人信息")} subtitle={t("你的统计、资料和账号设置。")}>
          <MemberNav token={props.token} admin={m.canAdmin} current="profile" />
          <MyStatsCard base={base} />
          <MyProfile base={base} />
          <InstallCard home={props.token ? `/m/${props.token}` : "/me"} />
          <PushCard base={base} home={props.token ? `/m/${props.token}` : "/me"} memberId={m.id} />
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
      <button type="button" class="button secondary block" onClick={() => setOpen(true)}>
        {t("修改用户名")}
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
    <Card title={t("修改用户名")}>
      <form onSubmit={save}>
        <Field label={t("新用户名")} value={name} onInput={setName} />
        {error && <p class="error">{error}</p>}
        <button type="submit" class="button block" disabled={busy}>
          {t("保存")}
        </button>
        <button class="button secondary block" type="button" onClick={() => setOpen(false)}>
          {t("取消")}
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
            <SectionTitle>{t("我报名的活动")}</SectionTitle>
            {mine.length === 0 && (
              <Card>
                <Empty>{r.history.length > 0 ? t("最近没有报名的活动") : t("还没有报名过活动")}</Empty>
              </Card>
            )}
            {mine.map((e) => (
              <SignupCard key={e.id} base={props.base} e={e} onChange={reload} />
            ))}
            {open.length > 0 && (
              <>
                <SectionTitle>{t("可以报名")}</SectionTitle>
                {open.map((e) => (
                  <SignupCard key={e.id} base={props.base} e={e} onChange={reload} />
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
        <summary>{t("历史活动（{n}）", { n: props.list.length })}</summary>
        <ul class="history-list">
          {props.list.map((h) => (
            <li key={h.id}>
              <a href={`/e/${h.code}`}>
                <span class="history-when">{fmtDate(h.date, !h.date.startsWith(thisYear))}</span>
                <span class="history-what">
                  {h.title || h.location}
                  {h.friends > 0 && <small> · {t("带 {n} 人", { n: h.friends })}</small>}
                  {!h.attended && <small class="history-absent"> · {t("缺席")}</small>}
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

export function SignupCard(props: { base: string; e: MyEvent; onChange: () => void }) {
  const e = props.e;
  const [editing, setEditing] = useState(false);
  const [friends, setFriends] = useState<string[]>(e.myFriends ?? []);
  const { busy, error, run } = useAction();
  const signedUp = e.selfSignedUp;
  // Who runs it, by name: the organizer on theirs, the Owner on the rest (names, not 群主).
  const runner = e.managerName;
  // Friends added for them come from the admin page: the organizer's, or the Owner's on any event.
  const adder = e.managerName === e.ownerName ? e.ownerName : t("{a} 或 {b}", { a: e.managerName, b: e.ownerName });
  // Whoever runs it may hang friends under a member who isn't coming: they are on the bill, not the list.
  const friendsOnly = !signedUp && (e.myFriends?.length ?? 0) > 0;

  async function save() {
    if (await run(() => api(`${props.base}/events/${e.id}/signup`, { friends }))) {
      setEditing(false);
      props.onChange();
    }
  }
  async function cancel() {
    // Friends hung under them go too, the ones added for them from the admin page included (Ke Li's call).
    const n = e.myFriends?.length ?? 0;
    const question = friendsOnly
      ? t("把名下的 {n} 个朋友从名单上去掉？", { n })
      : n
        ? t("取消你自己和名下 {n} 个朋友的报名？", { n })
        : t("确定取消报名吗？");
    if (!confirm(question)) return;
    if (await run(() => api(`${props.base}/events/${e.id}/cancel`, {}))) props.onChange();
  }

  return (
    <Card>
      <EventInfo
        e={e}
        status={
          e.payment ? { ...BILL_STATUS[e.payment.status], label: t(BILL_STATUS[e.payment.status].label) } : undefined
        }
        runBy={e.organizer ? t("组织：{name}", { name: e.organizer }) : undefined}
      />
      {e.roster && e.roster.length > 0 && (
        <RosterList roster={e.roster} open={e.status === "open" || e.status === "closed"} />
      )}
      {signedUp && !editing && !e.payment && (
        <p class="ok">
          ✓ {e.myFriends!.length > 0 ? t("已报名，带 {n} 个朋友", { n: e.myFriends!.length }) : t("已报名")}
        </p>
      )}
      {friendsOnly && !editing && e.runByMe && (
        <p class="muted">
          {t("你本人没有报名；名单上有挂在你名下的 {n} 个朋友，费用算在你的账单上。", { n: e.myFriends!.length })}
        </p>
      )}
      {friendsOnly && !editing && !e.runByMe && (
        <p class="muted">
          {t("你本人没有报名；{adder}在你名下加了 {n} 个朋友，费用算在你的账单上。", {
            adder,
            n: e.myFriends!.length,
          })}
        </p>
      )}
      {!signedUp && !friendsOnly && !e.canEdit && <p class="muted">{t("你没有报名这次活动。")}</p>}
      {!editing && (
        <EventActions e={e} calendar={signedUp && !e.payment && (e.status === "open" || e.status === "closed")} />
      )}
      {e.canEdit && editing && (
        <>
          <FriendsEditor
            friends={friends}
            max={Math.max(e.friendCap, e.myFriends?.length ?? 0)}
            onChange={setFriends}
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
      {e.canEdit && !editing && (
        <>
          {error && <p class="error">{error}</p>}
          {signedUp ? (
            <div class="inline">
              <button
                type="button"
                class="button secondary"
                onClick={() => {
                  setFriends(e.myFriends ?? []);
                  setEditing(true);
                }}
              >
                {t("修改")}
              </button>
              <button type="button" class="button danger" disabled={busy} onClick={cancel}>
                {t("取消报名")}
              </button>
            </div>
          ) : friendsOnly ? (
            <div class="inline">
              <button
                type="button"
                class="button"
                onClick={() => {
                  // Signing up keeps the friends already under them.
                  setFriends(e.myFriends ?? []);
                  setEditing(true);
                }}
              >
                {t("我也报名")}
              </button>
              <button type="button" class="button danger" disabled={busy} onClick={cancel}>
                {t("去掉这些朋友")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              class="button block"
              onClick={() => {
                setFriends([]);
                setEditing(true);
              }}
            >
              {t("报名")}
            </button>
          )}
        </>
      )}
      {!e.canEdit && e.status === "closed" && (signedUp || friendsOnly) && (
        <p class="muted small">{t("报名已截止，需要修改请联系{name}。费用会在活动后公布。", { name: runner })}</p>
      )}
      {e.payment && <PaymentBox p={e.payment} />}
    </Card>
  );
}
