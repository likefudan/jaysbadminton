import { useState } from "preact/hooks";
import { checkPassword } from "../../shared/rules";
import type { LinkResponse, RevokeImpact } from "../../shared/types";
import { formatInstantZh } from "../../shared/time";
import { STYLES, type ThemeId } from "../../shared/themes";
import { api } from "../api";
import { Card, Field, LinkCard, Load, useAction } from "../components";
import { signOutGoogle } from "../GoogleAccount";
import { revokeSummary } from "../organizers";
import { type Loaded, useApi } from "../hooks";
import { setSiteTheme, setSiteTitle, useAppearance } from "../site";
import { ExportCard, SheetsCard } from "./AdminExport";
import { AdminGuide, ForwardingSteps } from "./AdminGuide";
import { RemindersCard, TelegramCard } from "./AdminTelegram";

/** 设置: the admin page's settings tab, one card per setting. */
export function Settings(props: { base: string; viaGoogle: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [newAdmin, setNewAdmin] = useState("");
  const [sub, setSub] = useState<"sheets" | null>(null);
  const pw = useAction();
  const link = useAction();

  async function changePassword(e: Event) {
    e.preventDefault();
    const err = checkPassword(next) ?? (next !== again ? "两次输入的新密码不一致" : null);
    if (err) return pw.setError(err);
    if (await pw.run(() => api(`${props.base}/settings/password`, { current, next }))) location.reload();
  }
  async function rotate() {
    if (!confirm("重新生成后，当前管理链接立即失效。继续吗？")) return;
    const r = await link.run(() => api<LinkResponse>(`${props.base}/settings/rotate-admin`, {}));
    if (r) setNewAdmin(r.link);
  }
  async function logout() {
    if (props.viaGoogle) {
      await signOutGoogle().catch(() => location.assign("/login"));
      return;
    }
    await api(`${props.base}/logout`, {}).catch(() => undefined);
    location.reload();
  }

  if (sub === "sheets") {
    return (
      <>
        <button type="button" class="back" onClick={() => setSub(null)}>
          ‹ 设置
        </button>
        <SheetsCard base={props.base} />
      </>
    );
  }

  return (
    <>
      <ThemeCard base={props.base} />
      <PaymentCard base={props.base} />
      <FriendCap base={props.base} />
      <TelegramCard base={props.base} />
      <RemindersCard base={props.base} />
      <ExportCard base={props.base} />
      <Card>
        <button type="button" class="menu-row" onClick={() => setSub("sheets")}>
          <span>
            <strong>Google 表格同步</strong>
            <small>每天把数据备份到你自己的 Google 表格</small>
          </span>
          <span class="chevron">›</span>
        </button>
      </Card>
      <GoogleAdminCard base={props.base} viaGoogle={props.viaGoogle} />
      <Card title="修改群主密码">
        <form onSubmit={changePassword}>
          <Field
            label="当前密码"
            type="password"
            value={current}
            onInput={setCurrent}
            autocomplete="current-password"
          />
          <Field label="新密码" type="password" value={next} onInput={setNext} autocomplete="new-password" />
          <Field label="再输一次新密码" type="password" value={again} onInput={setAgain} autocomplete="new-password" />
          {pw.error && <p class="error">{pw.error}</p>}
          <button type="submit" class="button block" disabled={pw.busy}>
            保存新密码
          </button>
          <p class="muted small">
            修改后所有设备都会退出登录。忘记密码时，改 GitHub 里的 ADMIN_PASSWORD 并重新部署即可重置。
          </p>
        </form>
      </Card>
      <Card title="管理链接">
        {newAdmin ? (
          <>
            <LinkCard title="新的管理链接" link={newAdmin} note="旧链接已失效，请收藏新链接。" />
            <a class="button block" href={new URL(newAdmin).pathname}>
              打开新链接
            </a>
          </>
        ) : (
          <>
            <p class="muted">怀疑管理链接泄露时，重新生成一个。</p>
            {link.error && <p class="error">{link.error}</p>}
            <button type="button" class="button secondary block" disabled={link.busy} onClick={rotate}>
              重新生成管理链接
            </button>
          </>
        )}
      </Card>
      <BackupKey base={props.base} />
      <button type="button" class="button secondary block" onClick={logout}>
        退出登录
      </button>
      <AdminGuide base={props.base} />
      <ResetAll base={props.base} />
    </>
  );
}

/**
 * 设置 for an organizer (design §10.2): their own payment settings with the Venmo forwarding steps,
 * their Telegram, and 不再当组织者. The group's settings, export and passwords stay the Owner's.
 */
export function OrganizerSettings(props: { base: string }) {
  // One read for both cards, so saving the payment settings refreshes the forwarding status too.
  const [profile, reload] = useApi<PaymentProfile>(`${props.base}/payment-profile`);
  return (
    <>
      <MyPaymentCard base={props.base} profile={profile} reload={reload} />
      <ForwardingCard profile={profile.state === "ok" ? profile.data : null} />
      <TelegramCard base={props.base} organizer />
      <RetireCard base={props.base} />
      <button
        type="button"
        class="button secondary block"
        onClick={() => signOutGoogle().catch(() => location.assign("/login"))}
      >
        退出登录
      </button>
    </>
  );
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
          <Card title="我的收款设置">
            <dl class="kv">
              <dt>Venmo</dt>
              <dd>{p.venmoUsername ? `@${p.venmoUsername}` : "（未填）"}</dd>
              <dt>通知邮箱</dt>
              <dd>{p.venmoEmail || "（未填）"}</dd>
              <dt>Zelle</dt>
              <dd>{p.zelleAccount || "（未填）"}</dd>
            </dl>
            {!p.venmoUsername || !p.venmoEmail ? (
              <p class="error">还没填好 Venmo 用户名和通知邮箱，你的活动不能结算。</p>
            ) : (
              <p class="muted small">你负责的活动，成员的钱付到这里。</p>
            )}
            <button type="button" class="link-button" onClick={() => setEditing(true)}>
              修改收款设置
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
    const note = changed && open > 0 ? `\n\n你还有 ${open} 张账单没收齐：60 天内付到旧账户的钱仍然会自动记账。` : "";
    if (!props.first && !confirm(`修改后，成员付款页上的收款账号会立即改变。确定修改吗？${note}`)) return;
    const body = { venmoUsername: venmo, venmoEmail, zelleAccount: zelle };
    if (await run(() => api(`${props.base}/payment-profile`, body))) props.onDone();
  }
  return (
    <Card title="我的收款设置">
      <form onSubmit={save}>
        {props.first && (
          <p class="muted small">
            你负责的活动，成员把钱付到这里。填好 Venmo 用户名和通知邮箱之前，你的活动可以报名，但不能结算。
          </p>
        )}
        <Field label="你的 Venmo 用户名" value={venmo} onInput={setVenmo} hint="不用加 @" />
        <Field
          label="Venmo 通知邮箱"
          type="email"
          value={venmoEmail}
          onInput={setVenmoEmail}
          hint="Venmo 账户里登记的、接收收款通知的邮箱。只有发到这个邮箱的 Venmo 收款邮件才会自动对账"
        />
        <Field
          label="你的 Zelle 账号（选填）"
          value={zelle}
          onInput={setZelle}
          hint="手机号或邮箱，显示在付款页作为备选；Zelle 收款需要你手动标记已付"
        />
        {error && <p class="error">{error}</p>}
        <button type="submit" class="button block" disabled={busy}>
          保存收款设置
        </button>
        {props.onCancel && (
          <button class="button secondary block" type="button" onClick={props.onCancel}>
            取消
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
    <Card title="Venmo 邮件转发">
      <p class="small">
        系统读取 Venmo 发给你的收款通知邮件，按备注里的付款编号自动记账。你的邮箱密码系统拿不到，只是把 Venmo
        的邮件转发过来；和羽毛球无关的收款会被忽略，不会保存。没设好转发的话，成员付款后要你手动标记已付。
      </p>
      <ForwardingSteps
        otherMail
        test={
          <>
            <b>测试</b>：设好以后，成员用 Venmo 付你负责的活动的账单时，账单会自动变成已付；没变的话，先看「收款 ›
            待确认」里有没有这笔，再检查上面几步；实在对不上，可以在活动的账单里手动标记已付。
          </>
        }
        confirm="Gmail 会往这个地址发一封确认邮件，里面有确认码。系统收到后会显示在下面（保留 24 小时），连了 Telegram 的话也会发给你。把确认码填回 Gmail，或打开里面的确认链接。"
      />
      {p?.gmailConfirm && (
        <div class="status-line">
          <b>Gmail 转发确认邮件</b>（{formatInstantZh(p.gmailConfirmAt ?? "")} 收到）：
          <pre class="gmail-confirm">{p.gmailConfirm}</pre>
        </div>
      )}
      {p && (
        <div class="status-line">
          <b>转发状态：</b>
          {p.lastVenmoEmailAt
            ? `已生效（最近一封在 ${formatInstantZh(p.lastVenmoEmailAt)} 收到）`
            : "还没收到你的 Venmo 账户的邮件"}
          {p.quietBills > 0 && (
            <p class="error">
              有 {p.quietBills} 笔账单发出好几天了，却一直没收到你的 Venmo 邮件。如果有人已经用 Venmo
              付过款，说明转发可能断了：请按上面的步骤检查 Gmail 的转发地址和过滤器。
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** 不再当组织者: the same as being revoked, by oneself; afterwards the admin page is closed to them. */
function RetireCard(props: { base: string }) {
  const { busy, error, run } = useAction();
  async function retire() {
    const preview = await run(() => api<{ events: RevokeImpact[] }>(`${props.base}/organizer/retire`));
    if (!preview) return;
    if (
      !confirm(
        `确定不再当组织者？${revokeSummary(preview.events, "你")}\n\n之后你就进不了管理页了，想再当组织者要请群主重新任命。`,
      )
    )
      return;
    if (await run(() => api(`${props.base}/organizer/retire`, {}))) location.assign("/me");
  }
  return (
    <Card title="不再当组织者">
      <p class="muted small">你负责的活动会交给群主。已经结算的活动，成员的钱仍然付到你的账户，直到收齐。</p>
      {error && <p class="error">{error}</p>}
      <button type="button" class="button danger block" disabled={busy} onClick={retire}>
        不再当组织者
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
    <Card title="备份网站密钥">
      <p class="muted small">
        TOKEN_KEY 用来加密保存成员链接和管理链接，Cloudflare 里看不到它的值。把它发到你的
        Telegram，存进密码管理器后删掉那条消息。
      </p>
      {done ? (
        <p>已发送到 Telegram。</p>
      ) : (
        <form onSubmit={submit}>
          <Field
            label="群主密码"
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button secondary block" disabled={busy || !password}>
            发送到 Telegram
          </button>
        </form>
      )}
    </Card>
  );
}

const RESET_PHRASE = "清空所有数据";

/** Wipes the site back to first-time setup; asks twice, then for the phrase and the password. */
function ResetAll(props: { base: string }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  function start() {
    if (confirm("清空后，所有成员、活动、报名、付款记录和设置都会被删除，网站回到初次设置状态。确定要继续吗？"))
      setOpen(true);
  }
  async function submit(e: Event) {
    e.preventDefault();
    if (!confirm("最后确认：真的清空所有数据？")) return;
    if (await run(() => api(`${props.base}/settings/reset`, { confirm: phrase, password }))) location.href = "/admin";
  }

  return (
    <Card title="危险操作">
      {!open ? (
        <>
          <p class="muted small">把网站重置成全新状态。只保留群主密码，清空后用它在 /admin 重新做初次设置。</p>
          <button type="button" class="button danger block" onClick={start}>
            清空所有数据
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p class="error">所有成员、活动、报名、付款记录、设置都会被删除，管理链接和所有成员链接都会失效。</p>
          <Field label={`请输入「${RESET_PHRASE}」`} value={phrase} onInput={setPhrase} />
          <Field
            label="群主密码"
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button danger block" disabled={busy || phrase !== RESET_PHRASE || !password}>
            确认清空
          </button>
          <button class="button secondary block" type="button" onClick={() => setOpen(false)}>
            取消
          </button>
        </form>
      )}
    </Card>
  );
}

interface GeneralSettings {
  siteTitle: string;
  showLeaderboard: boolean;
  friendCap: number;
  venmoUsername: string;
  venmoEmail: string;
  zelleAccount: string;
}

function FriendCap(props: { base: string }) {
  const [s] = useApi<GeneralSettings>(`${props.base}/settings`);
  return <Load result={s}>{(v) => <GeneralForm base={props.base} initial={v} />}</Load>;
}

function GeneralForm(props: { base: string; initial: GeneralSettings }) {
  return (
    <>
      <PublicPageCard base={props.base} initial={props.initial} />
      <SignupCard base={props.base} initial={props.initial} />
    </>
  );
}

/** 公共页面: what anyone with the site address sees. */
function PublicPageCard(props: { base: string; initial: GeneralSettings }) {
  const [title, setTitle] = useState(props.initial.siteTitle);
  const [board, setBoard] = useState(props.initial.showLeaderboard);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  async function toggleBoard(on: boolean) {
    setBoard(on);
    if (!(await run(() => api(`${props.base}/settings`, { showLeaderboard: on })))) setBoard(!on);
  }
  return (
    <Card title="公共页面">
      <Field
        label="网站标题"
        value={title}
        onInput={(v) => {
          setTitle(v);
          setSaved(false);
        }}
        hint="显示在每个页面顶部和浏览器标签上"
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
        {saved ? "已保存" : "保存标题"}
      </button>
      <label class="switch-card plain">
        <span>
          <strong>展示排行榜</strong>
          <small>在首页显示出勤排行榜（只有名字和次数，没有金额）</small>
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
      <p class="muted small">首页和活动页对所有人公开：只显示活动时间、地点和报名人数，不显示名单和收款情况。</p>
    </Card>
  );
}

function SignupCard(props: { base: string; initial: GeneralSettings }) {
  const [cap, setCap] = useState(String(props.initial.friendCap));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <Card title="报名设置">
      <Field
        label="每人最多带几个朋友"
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
        {saved ? "已保存" : "保存"}
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
          <Card title="收款设置">
            <dl class="kv">
              <dt>Venmo</dt>
              <dd>@{v.venmoUsername}</dd>
              <dt>通知邮箱</dt>
              <dd>{v.venmoEmail}</dd>
              <dt>Zelle</dt>
              <dd>{v.zelleAccount || "（未填）"}</dd>
            </dl>
            <button type="button" class="link-button" onClick={() => setEditing(true)}>
              🔒 修改收款设置（需要群主密码）
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
    if (!props.first && !confirm("修改后，成员付款页上的收款账号会立即改变。确定修改吗？")) return;
    const body = { venmoUsername: venmo, venmoEmail, zelleAccount: zelle, password };
    if (await run(() => api(`${props.base}/settings/payment`, body))) props.onDone();
  }
  return (
    <Card title="收款设置">
      <form onSubmit={save}>
        {props.first && <p class="muted small">成员付款时用的账号，一般只需要设置一次。</p>}
        <Field label="你的 Venmo 用户名" value={venmo} onInput={setVenmo} hint="不用加 @，例如 KeLi8916" />
        <Field
          label="Venmo 通知邮箱"
          type="email"
          value={venmoEmail}
          onInput={setVenmoEmail}
          hint="Venmo 账户里登记的、接收收款通知的邮箱。只有发到这个邮箱的 Venmo 收款邮件才会自动对账"
        />
        <Field
          label="你的 Zelle 账号（选填）"
          value={zelle}
          onInput={setZelle}
          hint="手机号或邮箱，显示在付款页作为备选"
        />
        <Field
          label="群主密码"
          type="password"
          value={password}
          onInput={setPassword}
          autocomplete="current-password"
          hint="为防止误改，保存收款设置需要输入群主密码"
        />
        {error && <p class="error">{error}</p>}
        <button type="submit" class="button block" disabled={busy || !password}>
          保存收款设置
        </button>
        {props.onCancel && (
          <button class="button secondary block" type="button" onClick={props.onCancel}>
            取消
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
    <Card title="默认外观">
      {STYLES.map((s) => (
        <div key={s.id} class="theme-row">
          <span class="theme-label">{s.name}</span>
          {s.accents.map((x) => {
            const id = `${s.id}-${x.id}` as ThemeId;
            return (
              <button
                key={id}
                type="button"
                title={x.name}
                aria-label={`${s.name} ${x.name}`}
                class={id === a.site ? "swatch on" : "swatch"}
                style={{ background: `linear-gradient(135deg, ${x.swatch[0]}, ${x.swatch[1]})` }}
                onClick={() => choose(id)}
              />
            );
          })}
        </div>
      ))}
      <p class="muted small">
        所有人默认看到的样子。每个人也可以点右上角的 ◐ 换成自己喜欢的，只对他自己的手机生效。
        {a.mine && "（你自己选了别的外观，所以这里换了你看不到变化。）"}
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
    location.assign(`/api/auth/google?next=${encodeURIComponent(`${location.pathname}?tab=settings`)}`);
  async function bind() {
    if (await run(() => api(`${props.base}/settings/google/bind`, {}))) reload();
  }
  async function unbind() {
    if (!confirm("解除后不能再用这个 Google 账号进入管理页（管理链接和密码照常可用）。继续吗？")) return;
    if (!(await run(() => api(`${props.base}/settings/google/unbind`, {})))) return;
    if (props.viaGoogle) location.assign("/admin");
    else reload();
  }
  return (
    <Card title="用 Google 登录管理页">
      <Load result={res}>
        {(g) =>
          g.bound !== null ? (
            <>
              <p>
                已绑定 <strong>{g.bound || "Google 账号"}</strong>。用这个账号登录后，在首页或 /admin
                就能直接进入管理页，不用链接和密码。
              </p>
              {error && <p class="error">{error}</p>}
              <button type="button" class="button secondary block" disabled={busy} onClick={unbind}>
                解除绑定
              </button>
            </>
          ) : (
            <>
              <p class="muted">
                绑定一个 Google 账号（只能一个），以后用它登录就能直接进入管理页。管理链接和密码仍然可用。
              </p>
              {g.current?.holder ? (
                <p class="error">
                  当前登录的 {g.current.email} 已经属于成员「{g.current.holder}」，一个 Google
                  账号只能对应一个人。请换一个账号。
                </p>
              ) : g.current ? (
                <p>当前浏览器登录的 Google 账号：{g.current.email}</p>
              ) : null}
              {error && <p class="error">{error}</p>}
              {g.current && !g.current.holder ? (
                <button type="button" class="button block" disabled={busy} onClick={bind}>
                  绑定 {g.current.email}
                </button>
              ) : (
                <button type="button" class="button secondary block" onClick={signIn}>
                  {g.current ? "换一个 Google 账号" : "先登录 Google"}
                </button>
              )}
              <p class="muted small">请给这个 Google 账号开启两步验证：绑定后它就是进入管理页的钥匙。</p>
            </>
          )
        }
      </Load>
    </Card>
  );
}
