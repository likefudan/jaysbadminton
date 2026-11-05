import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { AI_EFFORTS, AI_USE_NAME, AI_USES, type AiChoice, type AiEffort, type AiUse } from "../../shared/ai";
import { SHORTCUT_NAME, SHORTCUT_URL_RE } from "../../shared/calories";
import {
  APP_NAME_MAX,
  SITE_LANGS,
  appNameFor,
  type AppNames,
  MAX_AUTO_JOINS_PER_DAY,
  checkAutoJoinCap,
  checkPassword,
} from "../../shared/rules";
import type { LinkResponse, RevokeImpact } from "../../shared/types";
import { STYLES, type ThemeId } from "../../shared/themes";
import { api } from "../api";
import { Card, Field, LinkCard, Load, SettingRow, useAction } from "../components";
import { signOutGoogle } from "../GoogleAccount";
import { revokeSummary } from "../organizers";
import { type Loaded, useApi } from "../hooks";
import { setAppNames, setSiteTheme, setSiteTitle, useAppearance } from "../site";
import { ExportCard, SheetsCard } from "./AdminExport";
import { AdminGuide, ForwardingSteps, OrganizerGuide } from "./AdminGuide";
import { DunningCard, RemindersCard, TelegramCard, type TelegramStatus } from "./AdminTelegram";
import { LANGS, currentLang, t, tk, tx, fmtInstant } from "../i18n";

type Sub = "looks" | "join" | "pay" | "advanced" | "security" | "sheets" | "appNames";
const SUBS: readonly Sub[] = ["looks", "join", "pay", "advanced", "security", "sheets", "appNames"];

/** The sub-page named in ?sub= (Google sign-in comes back to 账号与安全 this way). */
function initialSub(): Sub | null {
  const s = new URLSearchParams(location.search).get("sub");
  return SUBS.includes(s as Sub) ? (s as Sub) : null;
}

/**
 * 设置 (Ke Li 2026-11-05, option B): one menu, each group on its own page, since these are rarely
 * changed. The menu shows each group's current value; it reloads on the way back.
 */
function useSubPages(reload: () => void) {
  const [sub, setSub] = useState<Sub | null>(initialSub);
  const open = (s: Sub | null) => {
    setSub(s);
    if (s === null) reload();
    window.scrollTo(0, 0);
  };
  return [sub, open] as const;
}

/** A second-level page under 设置: the way back and its name. */
function SubPage(props: { title?: string; back: () => void; backLabel?: string; children: ComponentChildren }) {
  return (
    <>
      <button type="button" class="back" onClick={props.back}>
        {props.backLabel ?? t("‹ 设置")}
      </button>
      {props.title && <h2 class="sub-title">{props.title}</h2>}
      {props.children}
    </>
  );
}

function SheetsRow(props: { readOnly?: boolean; open: () => void }) {
  return (
    <Card>
      <button type="button" class="menu-row" onClick={props.open}>
        <span>
          <strong>{t("Google 表格同步")}</strong>
          <small>{props.readOnly ? t("看看每天的备份是否正常") : t("每天把数据备份到你自己的 Google 表格")}</small>
        </span>
        <span class="chevron">›</span>
      </button>
    </Card>
  );
}

/** The group settings both the Owner and admins change, by sub-page. */
function GroupSubPage(props: { base: string; sub: "looks" | "join" | "appNames"; open: (s: Sub | null) => void }) {
  const [s] = useApi<GeneralSettings>(`${props.base}/settings`);
  if (props.sub === "appNames")
    return (
      <SubPage back={() => props.open("looks")} backLabel={t("‹ 外观和公共页面")}>
        <Load result={s}>{(v) => <AppNamesCard base={props.base} initial={v.appNames} siteTitle={v.siteTitle} />}</Load>
      </SubPage>
    );
  if (props.sub === "looks")
    return (
      <SubPage title={t("外观和公共页面")} back={() => props.open(null)}>
        <ThemeCard base={props.base} />
        <Load result={s}>
          {(v) => <PublicPageCard base={props.base} initial={v} openAppNames={() => props.open("appNames")} />}
        </Load>
      </SubPage>
    );
  return (
    <SubPage title={t("入群和报名")} back={() => props.open(null)}>
      <Load result={s}>
        {(v) => (
          <>
            <JoinCard base={props.base} initial={v} />
            <SignupCard base={props.base} initial={v} />
          </>
        )}
      </Load>
    </SubPage>
  );
}

/** 高级设置's group cards after Telegram and reminders: export, Sheets, AI, calories, past events. */
function AdvancedCards(props: { base: string; readOnlySheets?: boolean; openSheets: () => void }) {
  const [s] = useApi<GeneralSettings>(`${props.base}/settings`);
  return (
    <>
      <RemindersCard base={props.base} />
      <SheetsRow readOnly={props.readOnlySheets} open={props.openSheets} />
      <ExportCard base={props.base} />
      <Load result={s}>
        {(v) => (
          <>
            <AiCard base={props.base} initial={v.ai} />
            <ShortcutCard base={props.base} initial={v} />
            <DaysCard base={props.base} initial={v} />
          </>
        )}
      </Load>
    </>
  );
}

function joinValue(g: Loaded<GeneralSettings>) {
  return g.state === "ok" ? (g.data.autoJoin ? t("入群不需要审核") : t("入群要审核")) : null;
}
function telegramValue(s: Loaded<TelegramStatus>) {
  return s.state === "ok" ? (s.data.connected ? t("Telegram 已连接") : t("Telegram 未连接")) : null;
}
const venmoValue = (name: string | undefined) => (name ? `@${name}` : <span class="muted">{t("未填写")}</span>);

/** 设置 for the Owner: the menu, 使用指南 and 退出登录; everything else one level down. */
export function Settings(props: { base: string; viaGoogle: boolean }) {
  const [general, reloadGeneral] = useApi<GeneralSettings>(`${props.base}/settings`);
  // Shared by the Telegram card and 使用指南's checklist.
  const [telegram, reloadTelegram] = useApi<TelegramStatus>(`${props.base}/telegram`);
  const [sub, open] = useSubPages(() => {
    reloadGeneral();
    reloadTelegram();
  });
  const home = () => open(null);

  async function logout() {
    if (props.viaGoogle) {
      await signOutGoogle().catch(() => location.assign("/login"));
      return;
    }
    await api(`${props.base}/logout`, {}).catch(() => undefined);
    location.reload();
  }

  if (sub === "looks" || sub === "join" || sub === "appNames")
    return <GroupSubPage base={props.base} sub={sub} open={open} />;
  if (sub === "sheets")
    return (
      <SubPage back={() => open("advanced")} backLabel={t("‹ 高级设置")}>
        <SheetsCard base={props.base} />
      </SubPage>
    );
  if (sub === "pay")
    return (
      <SubPage title={t("收款设置")} back={home}>
        <PaymentCard base={props.base} />
        <DunningCard base={props.base} />
      </SubPage>
    );
  if (sub === "advanced")
    return (
      <SubPage title={t("高级设置")} back={home}>
        <TelegramCard base={props.base} status={telegram} reload={reloadTelegram} />
        <AdvancedCards base={props.base} openSheets={() => open("sheets")} />
      </SubPage>
    );
  if (sub === "security")
    return (
      <SubPage title={t("账号与安全")} back={home}>
        <GoogleAdminCard base={props.base} viaGoogle={props.viaGoogle} />
        <PasswordCard base={props.base} />
        <AdminLinkCard base={props.base} />
        <BackupKey base={props.base} />
        <ResetAll base={props.base} />
      </SubPage>
    );

  const g = general.state === "ok" ? general.data : null;
  return (
    <>
      <section class="card set-list">
        <SettingRow
          icon={<LooksIcon />}
          label={t("外观和公共页面")}
          value={g?.siteTitle}
          onClick={() => open("looks")}
        />
        <SettingRow
          icon={<JoinIcon />}
          label={t("入群和报名")}
          value={joinValue(general)}
          onClick={() => open("join")}
        />
        <SettingRow
          icon={<PayIcon />}
          label={t("收款设置")}
          value={g && venmoValue(g.venmoUsername)}
          onClick={() => open("pay")}
        />
        <SettingRow
          icon={<GearIcon />}
          label={t("高级设置")}
          value={telegramValue(telegram)}
          onClick={() => open("advanced")}
        />
        <SettingRow icon={<LockIcon />} label={t("账号与安全")} onClick={() => open("security")} />
      </section>
      <AdminGuide base={props.base} telegram={telegram} />
      <button type="button" class="button secondary block" onClick={logout}>
        {t("退出登录")}
      </button>
    </>
  );
}

function PasswordCard(props: { base: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const pw = useAction();
  async function changePassword(e: Event) {
    e.preventDefault();
    const err = checkPassword(next) ?? (next !== again ? t("两次输入的新密码不一致") : null);
    if (err) return pw.setError(err);
    if (await pw.run(() => api(`${props.base}/settings/password`, { current, next }))) location.reload();
  }
  return (
    <Card title={t("修改群主密码")}>
      <form onSubmit={changePassword}>
        <Field
          label={t("当前密码")}
          type="password"
          value={current}
          onInput={setCurrent}
          autocomplete="current-password"
        />
        <Field label={t("新密码")} type="password" value={next} onInput={setNext} autocomplete="new-password" />
        <Field
          label={t("再输一次新密码")}
          type="password"
          value={again}
          onInput={setAgain}
          autocomplete="new-password"
        />
        {pw.error && <p class="error">{pw.error}</p>}
        <button type="submit" class="button block" disabled={pw.busy}>
          {t("保存新密码")}
        </button>
        <p class="muted small">
          {t("修改后所有设备都会退出登录。忘记密码时，改 GitHub 里的 ADMIN_PASSWORD 并重新部署即可重置。")}
        </p>
      </form>
    </Card>
  );
}

function AdminLinkCard(props: { base: string }) {
  const [newAdmin, setNewAdmin] = useState("");
  const link = useAction();
  async function rotate() {
    if (!confirm(t("重新生成后，当前管理链接立即失效。继续吗？"))) return;
    const r = await link.run(() => api<LinkResponse>(`${props.base}/settings/rotate-admin`, {}));
    if (r) setNewAdmin(r.link);
  }
  return (
    <Card title={t("管理链接")}>
      {newAdmin ? (
        <>
          <LinkCard title={t("新的管理链接")} link={newAdmin} note={t("旧链接已失效，请收藏新链接。")} />
          <a class="button block" href={new URL(newAdmin).pathname}>
            {t("打开新链接")}
          </a>
        </>
      ) : (
        <>
          <p class="muted">{t("怀疑管理链接泄露时，重新生成一个。")}</p>
          {link.error && <p class="error">{link.error}</p>}
          <button type="button" class="button secondary block" disabled={link.busy} onClick={rotate}>
            {t("重新生成管理链接")}
          </button>
        </>
      )}
    </Card>
  );
}

const icon = (d: ComponentChildren) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    {d}
  </svg>
);
const LooksIcon = () =>
  icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
    </>,
  );
const JoinIcon = () =>
  icon(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18 8v6M15 11h6" />
    </>,
  );
const PayIcon = () =>
  icon(
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </>,
  );
const GearIcon = () =>
  icon(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>,
  );
const LockIcon = () =>
  icon(
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>,
  );

/**
 * 设置 for an organizer (design §10.2): their own payment settings with the Venmo forwarding steps,
 * their Telegram, and 不再当组织者. The group's settings, export and passwords stay the Owner's.
 */
export function OrganizerSettings(props: { base: string }) {
  // One read for both cards, so saving the payment settings refreshes the forwarding status too.
  const [profile, reload] = useApi<PaymentProfile>(`${props.base}/payment-profile`);
  const p = profile.state === "ok" ? profile.data : null;
  // Shared with 给组织者的说明 the same way, so connecting Telegram ticks its step.
  const [telegram, reloadTelegram] = useApi<TelegramStatus>(`${props.base}/telegram`);
  return (
    <>
      <OrganizerGuide
        payment={done(profile, (d) => !!d.venmoUsername && !!d.venmoEmail)}
        forwarding={done(profile, (d) => !!d.lastVenmoEmailAt)}
        telegram={done(telegram, (d) => (d.botReady ? d.connected : null))}
      />
      <MyPaymentCard base={props.base} profile={profile} reload={reload} />
      <ForwardingCard profile={p} />
      <TelegramCard base={props.base} organizer status={telegram} reload={reloadTelegram} />
      <RetireCard base={props.base} />
      <button
        type="button"
        class="button secondary block"
        onClick={() => signOutGoogle().catch(() => location.assign("/login"))}
      >
        {t("退出登录")}
      </button>
    </>
  );
}

/**
 * 设置 for an admin (admin-role.zh.md): the setup checklist, then the same menu as the Owner's without
 * 账号与安全. 收款设置 holds their own payment settings and the Venmo forwarding; 高级设置 their own
 * Telegram, the group's reminders, export and the Sheets status. The password, admin link, backup
 * key, the Owner's Google sign-in and payment settings, and 清空数据 stay the Owner's.
 */
export function AdminRoleSettings(props: { base: string }) {
  const [profile, reload] = useApi<PaymentProfile>(`${props.base}/payment-profile`);
  const p = profile.state === "ok" ? profile.data : null;
  const [telegram, reloadTelegram] = useApi<TelegramStatus>(`${props.base}/telegram`);
  const [general, reloadGeneral] = useApi<GeneralSettings>(`${props.base}/settings`);
  const [sub, open] = useSubPages(() => {
    reloadGeneral();
    reloadTelegram();
  });
  const home = () => open(null);

  if (sub === "looks" || sub === "join" || sub === "appNames")
    return <GroupSubPage base={props.base} sub={sub} open={open} />;
  if (sub === "sheets")
    return (
      <SubPage back={() => open("advanced")} backLabel={t("‹ 高级设置")}>
        <SheetsCard base={props.base} readOnly />
      </SubPage>
    );
  if (sub === "pay")
    return (
      <SubPage title={t("收款设置")} back={home}>
        <MyPaymentCard base={props.base} profile={profile} reload={reload} />
        <ForwardingCard profile={p} />
        <DunningCard base={props.base} />
      </SubPage>
    );
  if (sub === "advanced")
    return (
      <SubPage title={t("高级设置")} back={home}>
        <TelegramCard base={props.base} organizer admin status={telegram} reload={reloadTelegram} />
        <AdvancedCards base={props.base} readOnlySheets openSheets={() => open("sheets")} />
      </SubPage>
    );

  const g = general.state === "ok" ? general.data : null;
  return (
    <>
      <OrganizerGuide
        admin
        payment={done(profile, (d) => !!d.venmoUsername && !!d.venmoEmail)}
        forwarding={done(profile, (d) => !!d.lastVenmoEmailAt)}
        telegram={done(telegram, (d) => (d.botReady ? d.connected : null))}
      />
      <section class="card set-list">
        <SettingRow
          icon={<PayIcon />}
          label={t("收款设置")}
          value={p && venmoValue(p.venmoUsername ?? undefined)}
          onClick={() => open("pay")}
        />
        <SettingRow
          icon={<LooksIcon />}
          label={t("外观和公共页面")}
          value={g?.siteTitle}
          onClick={() => open("looks")}
        />
        <SettingRow
          icon={<JoinIcon />}
          label={t("入群和报名")}
          value={joinValue(general)}
          onClick={() => open("join")}
        />
        <SettingRow
          icon={<GearIcon />}
          label={t("高级设置")}
          value={telegramValue(telegram)}
          onClick={() => open("advanced")}
        />
      </section>
      <RetireCard base={props.base} title={tk("管理员")} />
      <button
        type="button"
        class="button secondary block"
        onClick={() => signOutGoogle().catch(() => location.assign("/login"))}
      >
        {t("退出登录")}
      </button>
    </>
  );
}

/** A checklist step's state: undefined while loading; a status that failed to load counts as not done. */
function done<T, R>(loaded: Loaded<T>, test: (data: T) => R): R | false | undefined {
  if (loaded.state === "ok") return test(loaded.data);
  return loaded.state === "error" ? false : undefined;
}

interface PaymentProfile {
  venmoUsername: string;
  venmoEmail: string;
  zelleAccount: string;
  /** Bills of their events not paid up yet: a changed Venmo account stays recognized for 60 days. */
  outstandingBills: number;
  /** When the last Venmo email for their account arrived (转发已生效). */
  lastVenmoEmailAt: string | null;
  /** Bills paying into their account out for days with no Venmo email: forwarding may be broken. */
  quietBills: number;
  /** Gmail's forwarding confirmation for their address, kept 24 hours. */
  gmailConfirm: string | null;
  gmailConfirmAt: string | null;
}

/** 我的收款设置: where members pay for the events this organizer runs. Finalize needs Venmo and its email. */
function MyPaymentCard(props: { base: string; profile: Loaded<PaymentProfile>; reload: () => void }) {
  const reload = props.reload;
  const [editing, setEditing] = useState(false);
  return (
    <Load result={props.profile}>
      {(p) => {
        // Nothing saved yet: straight to the form. Finalize needs Venmo and its email, so a profile
        // without them (Zelle only) shows what is missing instead.
        const empty = !p.venmoUsername && !p.venmoEmail && !p.zelleAccount;
        if (editing || empty)
          return (
            <MyPaymentForm
              base={props.base}
              initial={p}
              first={empty}
              onDone={() => {
                setEditing(false);
                reload();
              }}
              onCancel={empty ? undefined : () => setEditing(false)}
            />
          );
        return (
          <Card title={t("我的收款设置")}>
            <dl class="kv">
              <dt>Venmo</dt>
              <dd>{p.venmoUsername ? `@${p.venmoUsername}` : t("（未填）")}</dd>
              <dt>{t("通知邮箱")}</dt>
              <dd>{p.venmoEmail || t("（未填）")}</dd>
              <dt>Zelle</dt>
              <dd>{p.zelleAccount || t("（未填）")}</dd>
            </dl>
            {!p.venmoUsername || !p.venmoEmail ? (
              <p class="error">{t("还没填好 Venmo 用户名和通知邮箱，你的活动不能结算。")}</p>
            ) : (
              <p class="muted small">{t("你负责的活动，成员的钱付到这里。")}</p>
            )}
            <button type="button" class="link-button" onClick={() => setEditing(true)}>
              {t("修改收款设置")}
            </button>
          </Card>
        );
      }}
    </Load>
  );
}

function MyPaymentForm(props: {
  base: string;
  initial: PaymentProfile;
  first: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [venmo, setVenmo] = useState(props.initial.venmoUsername);
  const [venmoEmail, setVenmoEmail] = useState(props.initial.venmoEmail);
  const [zelle, setZelle] = useState(props.initial.zelleAccount);
  const { busy, error, run } = useAction();
  const open = props.initial.outstandingBills;
  async function save(e: Event) {
    e.preventDefault();
    const changed = props.initial.venmoUsername && venmo.replace(/^@/, "") !== props.initial.venmoUsername;
    const note =
      changed && open > 0 ? t("\n\n你还有 {open} 张账单没收齐：60 天内付到旧账户的钱仍然会自动记账。", { open }) : "";
    if (!props.first && !confirm(t("修改后，成员付款页上的收款账号会立即改变。确定修改吗？{note}", { note }))) return;
    const body = { venmoUsername: venmo, venmoEmail, zelleAccount: zelle };
    if (await run(() => api(`${props.base}/payment-profile`, body))) props.onDone();
  }
  return (
    <Card title={t("我的收款设置")}>
      <form onSubmit={save}>
        {props.first && (
          <p class="muted small">
            {t("你负责的活动，成员把钱付到这里。填好 Venmo 用户名和通知邮箱之前，你的活动可以报名，但不能结算。")}
          </p>
        )}
        <Field label={t("你的 Venmo 用户名")} value={venmo} onInput={setVenmo} hint={t("不用加 @")} />
        <Field
          label={t("Venmo 通知邮箱")}
          type="email"
          value={venmoEmail}
          onInput={setVenmoEmail}
          hint={t("Venmo 账户里登记的、接收收款通知的邮箱。只有发到这个邮箱的 Venmo 收款邮件才会自动对账")}
        />
        <Field
          label={t("你的 Zelle 账号（选填）")}
          value={zelle}
          onInput={setZelle}
          hint={t("手机号或邮箱，显示在付款页作为备选；Zelle 收款需要你手动标记已付")}
        />
        {error && <p class="error">{error}</p>}
        <button type="submit" class="button block" disabled={busy}>
          {t("保存收款设置")}
        </button>
        {props.onCancel && (
          <button class="button secondary block" type="button" onClick={props.onCancel}>
            {t("取消")}
          </button>
        )}
      </form>
    </Card>
  );
}

/** Venmo 邮件转发: the same Gmail filter the Owner sets up, pointed at the one forwarding address. */
function ForwardingCard(props: { profile: PaymentProfile | null }) {
  const p = props.profile;
  return (
    <Card title={t("Venmo 邮件转发")}>
      <p class="small">
        {t(
          "系统读取 Venmo 发给你的收款通知邮件，按备注里的付款编号自动记账。你的邮箱密码系统拿不到，只是把 Venmo 的邮件转发过来；和羽毛球无关的收款会被忽略，不会保存。没设好转发的话，成员付款后要你手动标记已付。",
        )}
      </p>
      <ForwardingSteps
        otherMail
        test={tx(
          "{b}：设好以后，成员用 Venmo 付你负责的活动的账单时，账单会自动变成已付；没变的话，先看「收款 › 待确认」里有没有这笔，再检查上面几步；实在对不上，可以在活动的账单里手动标记已付。",
          { b: <b>{t("测试")}</b> },
        )}
        confirm={t(
          "Gmail 会往这个地址发一封确认邮件，里面有确认码。系统收到后会显示在下面（保留 24 小时），连了 Telegram 的话也会发给你。把确认码填回 Gmail，或打开里面的确认链接。",
        )}
      />
      {p?.gmailConfirm && (
        <div class="status-line">
          {tx("{b}（{x} 收到）：", { b: <b>{t("Gmail 转发确认邮件")}</b>, x: fmtInstant(p.gmailConfirmAt ?? "") })}
          <pre class="gmail-confirm">{p.gmailConfirm}</pre>
        </div>
      )}
      {p && (
        <div class="status-line">
          <b>{t("转发状态：")}</b>
          {p.lastVenmoEmailAt
            ? t("已生效（最近一封在 {fmtInstant} 收到）", { fmtInstant: fmtInstant(p.lastVenmoEmailAt) })
            : t("还没收到你的 Venmo 账户的邮件")}
          {p.quietBills > 0 && (
            <p class="error">
              {tx(
                "有 {x} 笔账单发出好几天了，却一直没收到你的 Venmo 邮件。如果有人已经用 Venmo 付过款，说明转发可能断了：请按上面的步骤检查 Gmail 的转发地址和过滤器。",
                { x: p.quietBills },
              )}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** 不再当组织者: the same as being revoked, by oneself; afterwards the admin page is closed to them. */
function RetireCard(props: { base: string; title?: string }) {
  const title = t(props.title ?? tk("组织者"));
  const { busy, error, run } = useAction();
  async function retire() {
    const preview = await run(() => api<{ events: RevokeImpact[] }>(`${props.base}/organizer/retire`));
    if (!preview) return;
    if (
      !confirm(
        t("确定不再当{title}？{revokeSummary}\n\n之后你就进不了管理页了，想再当{title}要请群主重新任命。", {
          title,
          revokeSummary: revokeSummary(preview.events, true),
        }),
      )
    )
      return;
    if (await run(() => api(`${props.base}/organizer/retire`, {}))) location.assign("/me");
  }
  return (
    <Card title={t("不再当{title}", { title })}>
      <p class="muted small">{t("你负责的活动会交给群主。已经结算的活动，成员的钱仍然付到你的账户，直到收齐。")}</p>
      {error && <p class="error">{error}</p>}
      <button type="button" class="button danger block" disabled={busy} onClick={retire}>
        {t("不再当{title}", { title })}
      </button>
    </Card>
  );
}

/** Sends TOKEN_KEY to the Owner's Telegram so it can be kept somewhere safe (Cloudflare can't show it). */
function BackupKey(props: { base: string }) {
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  async function submit(e: Event) {
    e.preventDefault();
    if (await run(() => api(`${props.base}/settings/backup-key`, { password }))) {
      setDone(true);
      setPassword("");
    }
  }

  return (
    <Card title={t("备份网站密钥")}>
      <p class="muted small">
        {t(
          "TOKEN_KEY 用来加密保存成员链接和管理链接，Cloudflare 里看不到它的值。把它发到你的 Telegram，存进密码管理器后删掉那条消息。",
        )}
      </p>
      {done ? (
        <p>{t("已发送到 Telegram。")}</p>
      ) : (
        <form onSubmit={submit}>
          <Field
            label={t("群主密码")}
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button secondary block" disabled={busy || !password}>
            {t("发送到 Telegram")}
          </button>
        </form>
      )}
    </Card>
  );
}

// The server checks this exact phrase, so it stays Chinese in every language.
const RESET_PHRASE = tk("清空所有数据");

/** Wipes the site back to first-time setup; asks twice, then for the phrase and the password. */
function ResetAll(props: { base: string }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  function start() {
    if (confirm(t("清空后，所有成员、活动、报名、付款记录和设置都会被删除，网站回到初次设置状态。确定要继续吗？")))
      setOpen(true);
  }
  async function submit(e: Event) {
    e.preventDefault();
    if (!confirm(t("最后确认：真的清空所有数据？"))) return;
    if (await run(() => api(`${props.base}/settings/reset`, { confirm: phrase, password }))) location.href = "/admin";
  }

  return (
    <Card title={t("危险操作")}>
      {!open ? (
        <>
          <p class="muted small">{t("把网站重置成全新状态。只保留群主密码，清空后用它在 /admin 重新做初次设置。")}</p>
          <button type="button" class="button danger block" onClick={start}>
            {t("清空所有数据")}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p class="error">{t("所有成员、活动、报名、付款记录、设置都会被删除，管理链接和所有成员链接都会失效。")}</p>
          <Field label={t("请输入「{phrase}」", { phrase: RESET_PHRASE })} value={phrase} onInput={setPhrase} />
          <Field
            label={t("群主密码")}
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button danger block" disabled={busy || phrase !== RESET_PHRASE || !password}>
            {t("确认清空")}
          </button>
          <button class="button secondary block" type="button" onClick={() => setOpen(false)}>
            {t("取消")}
          </button>
        </form>
      )}
    </Card>
  );
}

interface GeneralSettings {
  siteTitle: string;
  appNames: AppNames;
  showLeaderboard: boolean;
  autoJoin: boolean;
  autoJoinCap: number;
  friendCap: number;
  pastEventDays: number;
  calorieReadDays: number;
  calorieShortcut: { url: string; version: number };
  ai: Record<AiUse, AiChoice>;
  venmoUsername: string;
  venmoEmail: string;
  zelleAccount: string;
}

/** 公共页面: what anyone with the site address sees. */
function PublicPageCard(props: { base: string; initial: GeneralSettings; openAppNames: () => void }) {
  const [title, setTitle] = useState(props.initial.siteTitle);
  const [board, setBoard] = useState(props.initial.showLeaderboard);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  async function toggleBoard(on: boolean) {
    setBoard(on);
    if (!(await run(() => api(`${props.base}/settings`, { showLeaderboard: on })))) setBoard(!on);
  }
  return (
    <Card title={t("公共页面")}>
      <Field
        label={t("网站标题")}
        value={title}
        onInput={(v) => {
          setTitle(v);
          setSaved(false);
        }}
      />
      <button
        type="button"
        class="button secondary block"
        disabled={busy}
        onClick={async () => {
          if (await run(() => api(`${props.base}/settings`, { siteTitle: title }))) {
            setSaved(true);
            setSiteTitle(title.trim());
          }
        }}
      >
        {saved ? t("已保存") : t("保存标题")}
      </button>
      <button type="button" class="menu-row" onClick={props.openAppNames}>
        <span>
          <strong>{t("桌面图标名称")}</strong>
          <small>{appNameFor(props.initial.appNames, currentLang(), title.trim())}</small>
        </span>
        <span class="chevron">›</span>
      </button>
      <label class="switch-card plain">
        <span>
          <strong>{t("展示排行榜")}</strong>
          <small>{t("在首页显示出勤排行榜（只有名字和次数，没有金额）")}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={board}
          checked={board}
          disabled={busy}
          onChange={(e) => toggleBoard((e.target as HTMLInputElement).checked)}
        />
      </label>
      {error && <p class="error">{error}</p>}
    </Card>
  );
}

/**
 * 桌面图标名称 (Ke Li 2026-11-04), its own page under 外观和公共页面: the name under the home-screen
 * icon in each language. Android won't let anyone rename it and iPhone only while adding, so the Owner
 * or an admin picks short ones here. The visitor's language picks the name; one not set uses
 * Simplified's, then the site title.
 */
function AppNamesCard(props: { base: string; initial: AppNames; siteTitle: string }) {
  const [names, setNames] = useState(props.initial);
  // What the site holds as far as this page knows: the last load or save.
  const [stored, setStored] = useState(props.initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run, setError } = useAction();
  const simplified = names["zh-CN"].trim();
  async function save() {
    const v = Object.fromEntries(SITE_LANGS.map((l) => [l, names[l].trim()])) as AppNames;
    if (SITE_LANGS.some((l) => [...v[l]].length > APP_NAME_MAX))
      return setError(t("桌面图标名称最多 {n} 个字", { n: APP_NAME_MAX }));
    // Only what changed here, so a name another admin saved meanwhile stays.
    const changed = Object.fromEntries(SITE_LANGS.filter((l) => v[l] !== stored[l]).map((l) => [l, v[l]]));
    if (await run(() => api(`${props.base}/settings`, { appNames: changed }))) {
      setSaved(true);
      const now = { ...stored, ...changed };
      setStored(now);
      setAppNames(now);
    }
  }
  return (
    <Card title={t("桌面图标名称")} class="app-names">
      <p class="muted">{t("添加到手机桌面后图标下面的名字。安卓添加时和添加后都不能改，苹果只能在添加时改一次。")}</p>
      {SITE_LANGS.map((l) => (
        <label class="field" key={l}>
          <span>{LANGS.find((x) => x.id === l)?.name}</span>
          <input
            type="text"
            value={names[l]}
            placeholder={l === "zh-CN" ? props.siteTitle : simplified || props.siteTitle}
            onInput={(e) => {
              setNames({ ...names, [l]: (e.target as HTMLInputElement).value });
              setSaved(false);
            }}
          />
        </label>
      ))}
      <p class="muted small">
        {t(
          "每个最多 {n} 个字（约 6 个汉字），太长桌面上会显示不全。按访客选的语言显示；没填的语言用简体中文的名字，简体也没填就用网站标题。已经添加的图标要删掉重新添加才会变。",
          { n: APP_NAME_MAX },
        )}
      </p>
      {error && <p class="error">{error}</p>}
      <button type="button" class="button block" disabled={busy} onClick={save}>
        {saved ? t("已保存") : t("保存")}
      </button>
    </Card>
  );
}

/** 入群不需要审核 (Ke Li 2026-11-03): 申请加入 lets people straight in; the Owner and admins switch it. */
function JoinCard(props: { base: string; initial: GeneralSettings }) {
  const [on, setOn] = useState(props.initial.autoJoin);
  const [cap, setCap] = useState(String(props.initial.autoJoinCap));
  const [saved, setSaved] = useState(false);
  const { busy, error, run, setError } = useAction();
  async function saveCap() {
    const n = Number(cap);
    const err = cap.trim() === "" ? checkAutoJoinCap(Number.NaN) : checkAutoJoinCap(n);
    if (err) return setError(err);
    if (await run(() => api(`${props.base}/settings`, { autoJoinCap: n }))) setSaved(true);
  }
  async function toggle(v: boolean) {
    setOn(v);
    if (!(await run(() => api(`${props.base}/settings`, { autoJoin: v })))) setOn(!v);
  }
  return (
    <Card title={t("入群设置")}>
      <label class="switch-card plain">
        <span>
          <strong>{t("入群不需要审核")}</strong>
          <small>{t("打开后，申请加入的人直接成为成员，不用在「待审核」里通过")}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={on}
          checked={on}
          disabled={busy}
          onChange={(e) => toggle((e.target as HTMLInputElement).checked)}
        />
      </label>
      {on && (
        <>
          <Field
            label={t("每天最多自动通过几人")}
            type="number"
            value={cap}
            onInput={(v) => {
              setCap(v);
              setSaved(false);
            }}
            hint={t("1–{n}，超过的申请回到「待审核」", { n: MAX_AUTO_JOINS_PER_DAY })}
          />
          <button type="button" class="button secondary block" disabled={busy} onClick={saveCap}>
            {saved ? t("已保存") : t("保存")}
          </button>
        </>
      )}
      {error && <p class="error">{error}</p>}
    </Card>
  );
}

function SignupCard(props: { base: string; initial: GeneralSettings }) {
  const [cap, setCap] = useState(String(props.initial.friendCap));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Card title={t("报名设置")}>
      <Field
        label={t("每人最多带几个朋友")}
        type="number"
        value={cap}
        onInput={(v) => {
          setCap(v);
          setSaved(false);
        }}
      />
      {error && <p class="error">{error}</p>}
      <button
        type="button"
        class="button secondary block"
        disabled={busy}
        onClick={async () => {
          if (await run(() => api(`${props.base}/settings`, { friendCap: Number(cap) }))) setSaved(true);
        }}
      >
        {saved ? t("已保存") : t("保存")}
      </button>
    </Card>
  );
}

/** 天数: how far back an already-started event may be created, and how long 读取卡路里 stays open (Ke Li). */
function DaysCard(props: { base: string; initial: GeneralSettings }) {
  const [past, setPast] = useState(String(props.initial.pastEventDays));
  const [kcal, setKcal] = useState(String(props.initial.calorieReadDays));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Card title={t("补建活动和卡路里")}>
      <Field
        label={t("可以补建多少天前开始的活动")}
        type="number"
        value={past}
        onInput={(v) => {
          setPast(v);
          setSaved(false);
        }}
      />
      <Field
        label={t("活动开始后多少天内可以读取卡路里")}
        type="number"
        value={kcal}
        onInput={(v) => {
          setKcal(v);
          setSaved(false);
        }}
      />
      {error && <p class="error">{error}</p>}
      <button
        type="button"
        class="button secondary block"
        disabled={busy}
        onClick={async () => {
          // Only what changed, so 群操作记录 names just that.
          const body = {
            ...(past !== String(props.initial.pastEventDays) && { pastEventDays: Number(past) }),
            ...(kcal !== String(props.initial.calorieReadDays) && { calorieReadDays: Number(kcal) }),
          };
          if (await run(() => api(`${props.base}/settings`, body))) setSaved(true);
        }}
      >
        {saved ? t("已保存") : t("保存")}
      </button>
    </Card>
  );
}

/**
 * 卡路里快捷指令: the iCloud link members install and the version it sends, so a new Shortcut needs
 * no deploy (Ke Li). Members whose last upload came from an older version are asked to update.
 */
function ShortcutCard(props: { base: string; initial: GeneralSettings }) {
  const [url, setUrl] = useState(props.initial.calorieShortcut.url);
  const [version, setVersion] = useState(String(props.initial.calorieShortcut.version));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setSaved(false);
  };
  return (
    <Card title={t("卡路里快捷指令")}>
      <p class="muted small">
        {tx(
          "快捷指令的名字必须是「{x}」。改了快捷指令以后：把发送的 v 加一，重新分享拿到新的 iCloud 链接，两样一起填在这里。用旧版本读取过的人，活动卡片上会提示更新。",
          { x: SHORTCUT_NAME },
        )}
      </p>
      <Field label={t("iCloud 链接")} type="url" verbatim value={url} onInput={edit(setUrl)} />
      <Field label={t("版本号（快捷指令发送的 v）")} type="number" value={version} onInput={edit(setVersion)} />
      {error && <p class="error">{error}</p>}
      <button
        type="button"
        class="button secondary block"
        disabled={busy || !SHORTCUT_URL_RE.test(url.trim())}
        onClick={async () => {
          const body = { calorieShortcut: { url: url.trim(), version: Number(version) } };
          if (await run(() => api(`${props.base}/settings`, body))) setSaved(true);
        }}
      >
        {saved ? t("已保存") : t("保存")}
      </button>
    </Card>
  );
}

const AI_USE_HINT: Record<AiUse, string> = {
  photo: tk("读球馆排队屏幕的照片，要能看图"),
  notes: tk("正式版发布后，把改动写成 Telegram 通知"),
};
const EFFORT_LABEL: Record<AiEffort, string> = { low: tk("低（快）"), medium: tk("中"), high: tk("高（慢）") };

/**
 * AI 模型 (Ke Li): which model on her Azure each use runs on, from what is deployed there right now.
 * A saved model that is no longer deployed still shows, marked, so the menu never hides the setting.
 */
function AiCard(props: { base: string; initial: Record<AiUse, AiChoice> }) {
  const [list] = useApi<{ models: string[]; ready: boolean }>(`${props.base}/settings/ai-models`);
  const [pick, setPick] = useState(props.initial);
  // What the server has: only changes from it are sent, so 群操作记录 names just those.
  const [stored, setStored] = useState(props.initial);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const models = list.state === "ok" ? list.data.models : [];
  const set = (use: AiUse, part: Partial<AiChoice>) => {
    setPick((p) => ({ ...p, [use]: { ...p[use], ...part } }));
    setSaved(false);
  };
  return (
    <Card title={t("AI 模型")}>
      {list.state === "ok" && !list.data.ready && (
        <p class="muted small">{t("还没有设置 Azure 的 key：拍照登记暂时用不了，发版说明直接列改动标题。")}</p>
      )}
      {list.state === "error" && <p class="error">{list.message}</p>}
      {AI_USES.map((use) => {
        const options = models.includes(pick[use].model) ? models : [pick[use].model, ...models];
        return (
          <div key={use} class="ai-model">
            <strong>{t(AI_USE_NAME[use])}</strong>
            <small class="muted">{t(AI_USE_HINT[use])}</small>
            <div class="inline">
              <label class="field">
                <span>{t("模型")}</span>
                <select
                  value={pick[use].model}
                  disabled={list.state !== "ok"}
                  onChange={(e) => set(use, { model: (e.target as HTMLSelectElement).value })}
                >
                  {options.map((m) => (
                    <option key={m} value={m}>
                      {list.state === "ok" && !models.includes(m) ? t("{m}（未部署）", { m }) : m}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>{t("思考强度")}</span>
                <select
                  value={pick[use].effort}
                  onChange={(e) => set(use, { effort: (e.target as HTMLSelectElement).value as AiEffort })}
                >
                  {AI_EFFORTS.map((x) => (
                    <option key={x} value={x}>
                      {t(EFFORT_LABEL[x])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        );
      })}
      <p class="muted small">{t("出错时自动改用 claude-sonnet-5-5。")}</p>
      {error && <p class="error">{error}</p>}
      <button
        type="button"
        class="button secondary block"
        disabled={busy}
        onClick={async () => {
          const ai = Object.fromEntries(
            AI_USES.filter((u) => pick[u].model !== stored[u].model || pick[u].effort !== stored[u].effort).map((u) => [
              u,
              pick[u],
            ]),
          );
          if (await run(() => api(`${props.base}/settings`, { ai }))) {
            setStored(pick);
            setSaved(true);
          }
        }}
      >
        {saved ? t("已保存") : t("保存")}
      </button>
    </Card>
  );
}

/**
 * 收款设置: where members' money goes. Shown read-only; changing it needs the admin password,
 * and every change is reported to the Owner's Telegram.
 */
function PaymentCard(props: { base: string }) {
  const [s, reload] = useApi<GeneralSettings>(`${props.base}/settings`);
  const [editing, setEditing] = useState(false);
  return (
    <Load result={s}>
      {(v) => {
        const empty = !v.venmoUsername;
        if (editing || empty) {
          return (
            <PaymentForm
              base={props.base}
              initial={v}
              first={empty}
              onDone={() => {
                setEditing(false);
                reload();
              }}
              onCancel={empty ? undefined : () => setEditing(false)}
            />
          );
        }
        return (
          <Card title={t("收款账户")}>
            <dl class="kv">
              <dt>Venmo</dt>
              <dd>@{v.venmoUsername}</dd>
              <dt>{t("通知邮箱")}</dt>
              <dd>{v.venmoEmail}</dd>
              <dt>Zelle</dt>
              <dd>{v.zelleAccount || t("（未填）")}</dd>
            </dl>
            <button type="button" class="link-button" onClick={() => setEditing(true)}>
              {t("🔒 修改收款账户（需要群主密码）")}
            </button>
          </Card>
        );
      }}
    </Load>
  );
}

function PaymentForm(props: {
  base: string;
  initial: GeneralSettings;
  first: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [venmo, setVenmo] = useState(props.initial.venmoUsername);
  const [venmoEmail, setVenmoEmail] = useState(props.initial.venmoEmail);
  const [zelle, setZelle] = useState(props.initial.zelleAccount);
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  async function save(e: Event) {
    e.preventDefault();
    if (!props.first && !confirm(t("修改后，成员付款页上的收款账号会立即改变。确定修改吗？"))) return;
    const body = { venmoUsername: venmo, venmoEmail, zelleAccount: zelle, password };
    if (await run(() => api(`${props.base}/settings/payment`, body))) props.onDone();
  }
  return (
    <Card title={t("收款账户")}>
      <form onSubmit={save}>
        {props.first && <p class="muted small">{t("成员付款时用的账号，一般只需要设置一次。")}</p>}
        <Field label={t("你的 Venmo 用户名")} value={venmo} onInput={setVenmo} hint={t("不用加 @，例如 KeLi8916")} />
        <Field
          label={t("Venmo 通知邮箱")}
          type="email"
          value={venmoEmail}
          onInput={setVenmoEmail}
          hint={t("Venmo 账户里登记的、接收收款通知的邮箱。只有发到这个邮箱的 Venmo 收款邮件才会自动对账")}
        />
        <Field
          label={t("你的 Zelle 账号（选填）")}
          value={zelle}
          onInput={setZelle}
          hint={t("手机号或邮箱，显示在付款页作为备选")}
        />
        <Field
          label={t("群主密码")}
          type="password"
          value={password}
          onInput={setPassword}
          autocomplete="current-password"
          hint={t("为防止误改，保存收款设置需要输入群主密码")}
        />
        {error && <p class="error">{error}</p>}
        <button type="submit" class="button block" disabled={busy || !password}>
          {t("保存收款设置")}
        </button>
        {props.onCancel && (
          <button class="button secondary block" type="button" onClick={props.onCancel}>
            {t("取消")}
          </button>
        )}
      </form>
    </Card>
  );
}

/** 网站默认外观: what everyone sees unless they pick their own look; saved at once. */
function ThemeCard(props: { base: string }) {
  const a = useAppearance();
  const { error, run } = useAction();
  async function choose(id: ThemeId) {
    const before = a.site;
    setSiteTheme(id);
    if (!(await run(() => api(`${props.base}/settings`, { theme: id })))) setSiteTheme(before);
  }
  return (
    <Card title={t("默认外观")}>
      {STYLES.map((s) => (
        <div key={s.id} class="theme-row">
          <span class="theme-label">{t(s.name)}</span>
          {s.accents.map((x) => {
            const id = `${s.id}-${x.id}` as ThemeId;
            return (
              <button
                key={id}
                type="button"
                title={t(x.name)}
                aria-label={`${t(s.name)} ${t(x.name)}`}
                class={id === a.site ? "swatch on" : "swatch"}
                style={{ background: `linear-gradient(135deg, ${x.swatch[0]}, ${x.swatch[1]})` }}
                onClick={() => choose(id)}
              />
            );
          })}
        </div>
      ))}
      <p class="muted small">
        {t("成员可以点右上角 ◐ 自己换。")}
        {a.mine && t("（你自己选了别的外观，所以这里换了你看不到变化。）")}
      </p>
      {error && <p class="error">{error}</p>}
    </Card>
  );
}

/**
 * 用 Google 登录管理页: binds the Google account signed in on this browser to the Owner. One account
 * is one person, so an account that already belongs to a member can't be bound.
 */
function GoogleAdminCard(props: { base: string; viaGoogle: boolean }) {
  type State = { bound: string | null; current: { email: string; holder: string | null; isOwner: boolean } | null };
  const [res, reload] = useApi<State>(`${props.base}/settings/google`);
  const { busy, error, run } = useAction();
  const signIn = () =>
    location.assign(`/api/auth/google?next=${encodeURIComponent(`${location.pathname}?tab=settings&sub=security`)}`);
  async function bind() {
    if (await run(() => api(`${props.base}/settings/google/bind`, {}))) reload();
  }
  async function unbind() {
    if (!confirm(t("解除后不能再用这个 Google 账号进入管理页（管理链接和密码照常可用）。继续吗？"))) return;
    if (!(await run(() => api(`${props.base}/settings/google/unbind`, {})))) return;
    if (props.viaGoogle) location.assign("/admin");
    else reload();
  }
  return (
    <Card title={t("用 Google 登录管理页")}>
      <Load result={res}>
        {(g) =>
          g.bound !== null ? (
            <>
              <p>
                {tx("已绑定 {strong}。用这个账号登录后，在首页或 /admin 就能直接进入管理页，不用链接和密码。", {
                  strong: <strong>{g.bound || t("Google 账号")}</strong>,
                })}
              </p>
              {error && <p class="error">{error}</p>}
              <button type="button" class="button secondary block" disabled={busy} onClick={unbind}>
                {t("解除绑定")}
              </button>
            </>
          ) : (
            <>
              <p class="muted">
                {t("绑定一个 Google 账号（只能一个），以后用它登录就能直接进入管理页。管理链接和密码仍然可用。")}
              </p>
              {g.current?.holder ? (
                <p class="error">
                  {tx("当前登录的 {x} 已经属于成员「{x2}」，一个 Google 账号只能对应一个人。请换一个账号。", {
                    x: g.current.email,
                    x2: g.current.holder,
                  })}
                </p>
              ) : g.current ? (
                <p>{t("当前浏览器登录的 Google 账号：{email}", { email: g.current.email })}</p>
              ) : null}
              {error && <p class="error">{error}</p>}
              {g.current && !g.current.holder ? (
                <button type="button" class="button block" disabled={busy} onClick={bind}>
                  {tx("绑定 {x}", { x: g.current.email })}
                </button>
              ) : (
                <button type="button" class="button secondary block" onClick={signIn}>
                  {g.current ? t("换一个 Google 账号") : t("先登录 Google")}
                </button>
              )}
              <p class="muted small">{t("请给这个 Google 账号开启两步验证：绑定后它就是进入管理页的钥匙。")}</p>
            </>
          )
        }
      </Load>
    </Card>
  );
}
