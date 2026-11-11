import { useState } from "preact/hooks";
import { dollars } from "../../shared/settle";
import type {
  GuestChoice,
  MeResponse,
  MemberProfile,
  MyCalories,
  MyEvent,
  MyEventsResponse,
  MyStats,
  PaymentStatus,
} from "../../shared/types";
import { statusZh } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Load, Page, SectionTitle, SettingRow, useAction } from "../components";
import { CourtsLine, EventHero, FeeLine, MiniEventCard, friendCount, mapLink, mineStatus, onCard } from "../events";
import { type FriendSlot, FriendsEditor, fromSlots, toSlots } from "../FriendsEditor";
import { PaymentBox } from "../PaymentBox";
import { Heatmap, MeCard, ProfileSettings, activityCounts } from "../Profile";
import { AvatarForm } from "../Avatar";
import { RosterList } from "../Roster";
import { StayPicker } from "../Stay";
import { CourtQueue } from "../CourtQueue";
import { useApi } from "../hooks";
import { CardCornerIcons } from "../ShareCard";
import { SwipeSection } from "../Swipe";
import { SpendingCard, thisYear } from "../Stats";
import { YearReviewTop } from "../YearReview";
import { HeartIcon, LikeRow } from "../Likes";
import { CalorieRow, CaloriesPage, FlameIcon, FlameOutline, caloriesShown, kcalText } from "../Calories";
import { Panel } from "../Panel";
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
 * 个人信息 (Ke Li 2026-11-10, option C): what members come for first (who they are and their
 * year, the badges, who they play with), then 我的数据, one line each that opens a page of its
 * own, and 设置 behind the gear in the top card.
 */
export function MemberProfilePage(props: { token?: string }) {
  const base = `/api/m/${props.token ?? "session"}`;
  const home = props.token ? `/m/${props.token}` : "/me";
  const [me, reloadMe] = useApi<MeResponse>(`${base}/me`);
  const [profile, reloadProfile] = useApi<MemberProfile>(`${base}/profile`);
  const [stats] = useApi<MyStats>(`${base}/stats`);
  const [calories, reloadCalories] = useApi<MyCalories>(`${base}/calories`);
  const [open, setOpen] = useState<"spend" | "activity" | "calories" | "settings" | "avatar" | null>(null);
  const close = () => setOpen(null);
  const p = profile.state === "ok" ? profile.data : null;
  const s = stats.state === "ok" && stats.data.history.length > 0 ? stats.data : null;
  const c = calories.state === "ok" && caloriesShown(calories.data) ? calories.data : null;
  return (
    <Load result={me}>
      {(m) => {
        const card = {
          name: m.username,
          wechat: m.wechatNickname,
          joinedAt: p?.joinedAt,
          avatar: m.avatar,
          onSettings: () => setOpen("settings"),
          onAvatar: () => setOpen("avatar"),
        };
        const spent = s && thisYear(s);
        const days = p && activityCounts(p.activity);
        return (
          <Page title={t("个人信息")}>
            <MemberNav token={props.token} admin={m.canAdmin} current="profile" />
            {m.active ? <YearReviewTop base={base} me={card} /> : <MeCard {...card} />}
            {(s || p || c) && (
              <>
                <SectionTitle>{t("我的数据")}</SectionTitle>
                <section class="card set-list">
                  {spent && (
                    <SettingRow
                      icon={<ChartIcon />}
                      label={t("我的花费")}
                      sub={
                        spent.avgCents === null
                          ? t("今年 {n} 次", { n: spent.count })
                          : t("今年 {n} 次 · 平均 {avg}", { n: spent.count, avg: `$${dollars(spent.avgCents)}` })
                      }
                      value={wholeDollars(spent.cents)}
                      onClick={() => setOpen("spend")}
                    />
                  )}
                  {days && (
                    <SettingRow
                      icon={<CalendarIcon />}
                      label={t("活动记录")}
                      sub={days.absent ? t("今年 · 缺席 {n} 次", { n: days.absent }) : t("今年")}
                      value={t("{n} 次", { n: days.done })}
                      onClick={() => setOpen("activity")}
                    />
                  )}
                  {c && (
                    <SettingRow
                      icon={<FlameOutline />}
                      label={t("我的卡路里")}
                      sub={
                        c.yearCount > 0
                          ? `${t("{year} 年 {n} 场", { year: c.year, n: c.yearCount })}${c.board ? ` · ${t("已加入能量榜")}` : ""}`
                          : c.board
                            ? t("已加入能量榜")
                            : undefined
                      }
                      value={c.yearCount > 0 ? t("{n} 千卡", { n: kcalText(c.yearKcal) }) : undefined}
                      onClick={() => setOpen("calories")}
                    />
                  )}
                </section>
              </>
            )}
            {props.token && <GoogleLink token={props.token} />}
            {open === "spend" && s && (
              <Panel title={t("我的花费")} label={t("我的花费")} onClose={close}>
                <SpendingCard stats={s} />
              </Panel>
            )}
            {open === "activity" && p && (
              <Panel title={t("活动记录")} label={t("活动记录")} onClose={close}>
                <Card>
                  <Heatmap activity={p.activity} />
                </Card>
              </Panel>
            )}
            {open === "calories" && c && (
              <Panel title={t("我的卡路里")} label={t("我的卡路里")} onClose={close}>
                <CaloriesPage c={c} base={base} onChange={reloadCalories} />
              </Panel>
            )}
            {open === "avatar" && (
              <Panel title={t("头像")} label={t("头像")} onClose={close}>
                <section class="card">
                  <AvatarForm base={base} me={m} onDone={reloadMe} />
                </section>
              </Panel>
            )}
            {open === "settings" && (
              <Panel title={t("设置")} label={t("设置")} onClose={close}>
                {/* Here even if the profile didn't load: push and the home screen don't need it. */}
                <ProfileSettings
                  me={m}
                  profile={p}
                  base={base}
                  home={home}
                  onChange={() => {
                    reloadProfile();
                    reloadMe();
                  }}
                />
              </Panel>
            )}
          </Page>
        );
      }}
    </Load>
  );
}

/** "$1,563": the year's total at a glance; the page behind it has the cents. */
const wholeDollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
  </svg>
);
const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

const byTime = (a: { date: string; startTime?: string }, b: { date: string; startTime?: string }) =>
  `${a.date} ${a.startTime ?? ""}`.localeCompare(`${b.date} ${b.startTime ?? ""}`);

/**
 * Their own part is settled: paid up, or nothing billed to them once the bills are out. Brought by
 * someone (带群友): once that person has paid.
 */
const settledForMe = (e: MyEvent) =>
  e.status !== "open" &&
  (e.payment
    ? e.payment.status === "paid"
    : e.broughtBy
      ? e.broughtBy.paid || e.status === "settled"
      : e.status === "finalized" || e.status === "settled");

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
        // 无需收款: nothing to pay, so after the deadline it stays up here until it ends.
        const upcoming = (e: MyEvent) => e.status === "open" || (e.noFee && e.status === "closed");
        const open = r.events.filter(upcoming).sort(byTime);
        const owing = r.events.filter((e) => !upcoming(e) && !settledForMe(e)).sort(byTime);
        const settled = [
          ...r.events.filter(settledForMe).map((e) => ({
            ...e,
            amountCents: e.payment?.amountCents ?? null,
            paidBy: e.broughtBy?.name ?? null,
            likes: e.likes?.received ?? 0,
            likeOpen: e.likes?.open ?? false,
          })),
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
                        {h.noFee
                          ? t("每人自付场地费")
                          : h.unsettled
                            ? t("未结算，不收费")
                            : h.paidBy
                              ? t("{name} 已付清", { name: h.paidBy })
                              : h.amountCents
                                ? tx("已付清 {amount}", { amount: <b>${dollars(h.amountCents)}</b> })
                                : t("没有费用")}
                        {h.kcal != null && (
                          <span class="mini-kcal">
                            <FlameIcon size={12} />
                            {kcalText(h.kcal)}
                          </span>
                        )}
                        {/* 点赞 on the event's own page, where the card opens. */}
                        {(h.likes > 0 || h.likeOpen) && (
                          <span class="mini-likes" title={t("收到 {n} 个赞", { n: h.likes })}>
                            <HeartIcon size={12} filled={h.likes > 0} />
                            {h.likes > 0 ? h.likes : t("点个赞")}
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
  const saved = () => toSlots(e.myFriends ?? [], e.myGuests);
  const [friends, setFriends] = useState<FriendSlot[]>(saved);
  // 在场时间: optional 到 / 走 (Ke Li 2026-11-06).
  const myStay = e.myStay ?? { arrive: null, leave: null };
  const [stay, setStay] = useState(myStay);
  const { busy, error, run } = useAction();
  const signedUp = e.selfSignedUp;
  // 带群友: someone else brought them and pays; they can only say they're not coming (Ke Li).
  const brought = e.broughtBy;
  const nFriends = friendCount(e);
  // Who runs it, by name: the organizer on theirs, the Owner on the rest (names, not 群主).
  const runner = e.managerName;
  // Friends added for them come from the admin page: the organizer's, or the Owner's on any event.
  const adder = e.managerName === e.ownerName ? e.ownerName : t("{a} 或 {b}", { a: e.managerName, b: e.ownerName });
  // Whoever runs it may hang friends under a member who isn't coming: they are on the bill, not the list.
  const friendsOnly = !signedUp && nFriends > 0;
  // 我已报名 / 朋友已报名 / 已付清 with a tick once they're on it (Ke Li), so no 已报名 line underneath.
  const mine = mineStatus(e);
  const badge =
    mine ??
    (e.payment
      ? { ...BILL_STATUS[e.payment.status], label: t(BILL_STATUS[e.payment.status].label) }
      : { cls: e.status, label: t(statusZh(e)) });
  // Accent for the ones they're on until the bill comes (closed included, Ke Li), light accent for
  // ones they could join, plain for the rest (billed, cancelled, closed without them).
  const onIt = onCard(e);
  const tone =
    e.status === "open"
      ? onIt
        ? "hero"
        : "soft"
      : onIt && (e.status === "closed" || e.status === "finalized")
        ? "hero"
        : "plain";

  const choices = () => api<{ members: GuestChoice[] }>(`${props.base}/events/${e.id}/guests`).then((r) => r.members);

  async function save() {
    if (await run(() => api(`${props.base}/events/${e.id}/signup`, { ...fromSlots(friends), ...stay }))) {
      setEditing(false);
      props.onChange();
    }
  }
  function startEditing() {
    // Signing up keeps the friends already under them; a fresh sign-up starts with none.
    setFriends(signedUp || friendsOnly ? saved() : []);
    setStay(myStay);
    setEditing(true);
  }
  async function cancel() {
    // Friends hung under them go too, the ones added for them from the admin page included (Ke Li's call),
    // and the group members they bring.
    const n = nFriends;
    const question = brought
      ? t("确定不去了吗？")
      : friendsOnly
        ? t("把名下的 {n} 个朋友从名单上去掉？", { n })
        : n
          ? t("取消你自己和名下 {n} 个朋友的报名？", { n })
          : t("确定取消报名吗？");
    if (!confirm(question)) return;
    if (await run(() => api(`${props.base}/events/${e.id}/cancel`, {}))) {
      setEditing(false);
      props.onChange();
    }
  }

  return (
    <section class={`card ev-card tone-${tone}`}>
      <div class="ev-head">
        <EventHero
          e={e}
          status={badge}
          action={
            <CardCornerIcons e={e} calendar={signedUp && onIt && (e.status === "open" || e.status === "closed")} />
          }
        />
        {/* 报名 / 修改 in the top's corner, like 查看 / 报名 on the home card (Ke Li 2026-11-07). */}
        {e.canEdit && !editing && (
          <button type="button" class="next-cta ev-cta" onClick={startEditing}>
            {brought || signedUp ? t("修改") : friendsOnly ? t("我也报名") : t("报名")}
          </button>
        )}
      </div>
      <div class="ev-main">
        {e.address && (
          <a class="ev-meta address" href={mapLink(e.address)} target="_blank" rel="noreferrer">
            {e.address} ↗
          </a>
        )}
        {e.courts?.length > 0 && <CourtsLine courts={e.courts} />}
        <FeeLine e={e} />
        {e.organizer && <div class="ev-meta">{t("组织：{name}", { name: e.organizer })}</div>}
        {e.notes?.trim() && <div class="ev-meta event-notes">{e.notes}</div>}
        {/* Right under the top, near the 报名 / 修改 button that opens it. */}
        {e.canEdit && editing && (
          <div class="ev-edit">
            {!brought && (
              <>
                <StayPicker start={e.startTime} end={e.endTime} value={stay} onChange={setStay} />
                <FriendsEditor
                  friends={friends}
                  max={Math.max(e.friendCap, nFriends)}
                  onChange={setFriends}
                  choices={choices}
                />
              </>
            )}
            {error && <p class="error">{error}</p>}
            {!brought && (
              <button type="button" class="button block" disabled={busy} onClick={save}>
                {signedUp ? t("保存修改") : t("确认报名")}
              </button>
            )}
            {/* 取消报名 only shows once they tap 修改 (Ke Li 2026-11-07). */}
            {(signedUp || friendsOnly || brought) && (
              <button type="button" class="button danger block" disabled={busy} onClick={cancel}>
                {brought ? t("我不去了") : friendsOnly ? t("去掉这些朋友") : t("取消报名")}
              </button>
            )}
            <button type="button" class="button secondary block" disabled={busy} onClick={() => setEditing(false)}>
              {t("返回")}
            </button>
          </div>
        )}
        {!e.roster?.length && <div class="ev-meta">{tx("{n} 人已报名", { n: <b>{e.headcount}</b> })}</div>}
        {e.roster && e.roster.length > 0 && (
          <RosterList
            eventId={String(e.id)}
            roster={e.roster}
            open={e.status === "open" || e.status === "closed"}
            start={e.startTime}
            end={e.endTime}
            mine={signedUp ? myStay : null}
          />
        )}
        {e.queue && <CourtQueue base={props.base} e={e} onChange={props.onChange} />}
        {friendsOnly && !editing && e.runByMe && (
          <p class="muted">{t("{n} 个朋友的费用算在你账上", { n: nFriends })}</p>
        )}
        {friendsOnly && !editing && !e.runByMe && (
          <p class="muted">{t("{adder}在你名下加了 {n} 个朋友，费用算在你账上", { adder, n: nFriends })}</p>
        )}
        {!signedUp && !friendsOnly && !e.canEdit && <p class="muted">{t("你没有报名这次活动。")}</p>}
        {!e.canEdit && e.status === "closed" && (signedUp || friendsOnly) && !brought && (
          <p class="muted small">{t("修改请联系{name}", { name: runner })}</p>
        )}
        {e.payment && <PaymentBox p={e.payment} />}
        {/* Last on the card, under its own line (Ke Li): it comes after the game, the bill included. */}
        <CalorieRow base={props.base} e={e} onChange={props.onChange} />
        {/* 点赞 after the game, under 卡路里 (Ke Li 2026-11-11). */}
        <LikeRow base={props.base} e={e} onChange={props.onChange} />
      </div>
    </section>
  );
}
