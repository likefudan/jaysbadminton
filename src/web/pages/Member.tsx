import { useState } from "preact/hooks";
import { dollars } from "../../shared/settle";
import type { MeResponse, MemberProfile, MyEvent, MyEventsResponse, PaymentStatus } from "../../shared/types";
import { STATUS_ZH } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Load, Page, SectionTitle, useAction } from "../components";
import { CourtsLine, EventHero, MiniEventCard, mapLink, mineStatus } from "../events";
import { FriendsEditor } from "../FriendsEditor";
import { PaymentBox } from "../PaymentBox";
import { Heatmap, ProfileHero, ProfileSettings } from "../Profile";
import { RosterList } from "../Roster";
import { CourtQueue } from "../CourtQueue";
import { useApi } from "../hooks";
import { CardCornerIcons } from "../ShareCard";
import { SwipeSection } from "../Swipe";
import { MyStatsCard } from "../Stats";
import { CalorieRow, FlameIcon, MyCaloriesCard, kcalText } from "../Calories";
import { InstallPrompt } from "../Install";
import { PushPrompt } from "../Push";
import { GoogleLink } from "./Account";
import { t, tk, tx } from "../i18n";

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
          subtitle={props.token ? t("请不要把这个链接转发给别人。") : undefined}
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

/**
 * 个人信息 (Ke Li's pick of three designs): who they are and the year at a glance on top, then
 * spending, the activity map, and 资料与设置 as one list of rows.
 */
export function MemberProfilePage(props: { token?: string }) {
  const base = `/api/m/${props.token ?? "session"}`;
  const home = props.token ? `/m/${props.token}` : "/me";
  const [me, reloadMe] = useApi<MeResponse>(`${base}/me`);
  const [profile, reloadProfile] = useApi<MemberProfile>(`${base}/profile`);
  return (
    <Load result={me}>
      {(m) => (
        <Page title={t("个人信息")}>
          <MemberNav token={props.token} admin={m.canAdmin} current="profile" />
          <Load result={profile}>{(p) => <ProfileHero profile={p} />}</Load>
          <MyStatsCard base={base} />
          <MyCaloriesCard base={base} />
          {profile.state === "ok" && (
            <>
              <SectionTitle>{t("活动记录")}</SectionTitle>
              <Card>
                <Heatmap activity={profile.data.activity} summary={false} />
              </Card>
            </>
          )}
          <SectionTitle>{t("资料与设置")}</SectionTitle>
          {/* Here even if the profile didn't load: push and the home screen don't need it. */}
          <ProfileSettings
            me={m}
            profile={profile.state === "ok" ? profile.data : null}
            base={base}
            home={home}
            onChange={() => {
              reloadProfile();
              reloadMe();
            }}
          />
          {props.token && <GoogleLink token={props.token} />}
        </Page>
      )}
    </Load>
  );
}

const byTime = (a: { date: string; startTime?: string }, b: { date: string; startTime?: string }) =>
  `${a.date} ${a.startTime ?? ""}`.localeCompare(`${b.date} ${b.startTime ?? ""}`);

/** Their own part is settled: paid up, or nothing billed to them once the bills are out. */
const settledForMe = (e: MyEvent) =>
  e.status !== "open" && (e.payment ? e.payment.status === "paid" : e.status === "finalized" || e.status === "settled");

/**
 * 我的活动 in three parts (Ke Li's order): 报名中, signed up or not; 待结清, past the deadline with
 * their part not paid yet; 已结清, their part paid (an event closed early and settled lands here too,
 * even if it's still ahead). The first two run soonest first, 已结清 newest first.
 */
function MyEvents(props: { base: string }) {
  const [res, reload] = useApi<MyEventsResponse>(`${props.base}/events`);
  return (
    <Load result={res}>
      {(r) => {
        const open = r.events.filter((e) => e.status === "open").sort(byTime);
        const owing = r.events.filter((e) => e.status !== "open" && !settledForMe(e)).sort(byTime);
        const settled = [
          ...r.events.filter(settledForMe).map((e) => ({ ...e, amountCents: e.payment?.amountCents ?? null })),
          ...r.history,
        ].sort((a, b) => byTime(b, a));
        return (
          <>
            <SectionTitle>{t("报名中")}</SectionTitle>
            {open.length === 0 && (
              <Empty>
                {r.events.length === 0 && r.history.length === 0 ? t("还没有报名过活动") : t("暂时没有可以报名的活动")}
              </Empty>
            )}
            {open.map((e) => (
              <SignupCard key={e.id} base={props.base} e={e} onChange={reload} />
            ))}
            {owing.length > 0 && (
              <>
                <SectionTitle>{t("待结清")}</SectionTitle>
                {owing.map((e) => (
                  <SignupCard key={e.id} base={props.base} e={e} onChange={reload} />
                ))}
              </>
            )}
            {settled.length > 0 && (
              <SwipeSection title={t("已结清")}>
                {settled.map((h) => (
                  <MiniEventCard
                    key={h.id}
                    e={h}
                    line={
                      <>
                        {h.amountCents
                          ? tx("已付清 {amount}", { amount: <b>${dollars(h.amountCents)}</b> })
                          : t("没有费用")}
                        {h.kcal != null && (
                          <span class="mini-kcal">
                            <FlameIcon size={12} />
                            {kcalText(h.kcal)}
                          </span>
                        )}
                      </>
                    }
                  />
                ))}
              </SwipeSection>
            )}
          </>
        );
      }}
    </Load>
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
  // 我已报名 / 朋友已报名 / 已付清 with a tick once they're on it (Ke Li), so no 已报名 line underneath.
  const mine = mineStatus(e);
  const badge =
    mine ??
    (e.payment
      ? { ...BILL_STATUS[e.payment.status], label: t(BILL_STATUS[e.payment.status].label) }
      : { cls: e.status, label: t(STATUS_ZH[e.status]) });
  // Accent for the ones they're on until the bill comes (closed included, Ke Li), light accent for
  // ones they could join, plain for the rest (billed, cancelled, closed without them).
  const onIt = (signedUp || friendsOnly) && !e.payment;
  const tone =
    e.status === "open"
      ? onIt
        ? "hero"
        : "soft"
      : onIt && (e.status === "closed" || e.status === "finalized")
        ? "hero"
        : "plain";

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
    <section class={`card ev-card tone-${tone}`}>
      <div class="ev-head">
        <EventHero
          e={e}
          status={badge}
          action={
            <CardCornerIcons
              e={e}
              calendar={signedUp && !e.payment && (e.status === "open" || e.status === "closed")}
            />
          }
        />
      </div>
      <div class="ev-main">
        {e.address && (
          <a class="ev-meta address" href={mapLink(e.address)} target="_blank" rel="noreferrer">
            {e.address} ↗
          </a>
        )}
        {e.courts?.length > 0 && <CourtsLine courts={e.courts} />}
        {e.organizer && <div class="ev-meta">{t("组织：{name}", { name: e.organizer })}</div>}
        {e.notes?.trim() && <div class="ev-meta event-notes">{e.notes}</div>}
        {!e.roster?.length && <div class="ev-meta">{tx("{n} 人已报名", { n: <b>{e.headcount}</b> })}</div>}
        {e.roster && e.roster.length > 0 && (
          <RosterList roster={e.roster} open={e.status === "open" || e.status === "closed"} />
        )}
        <CalorieRow base={props.base} e={e} onChange={props.onChange} />
        {e.queue && <CourtQueue base={props.base} e={e} onChange={props.onChange} />}
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
      </div>
    </section>
  );
}
