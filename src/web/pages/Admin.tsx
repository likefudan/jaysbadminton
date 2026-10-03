import { useState } from "preact/hooks";
import { checkPassword } from "../../shared/rules";
import type { ApprovalEmailStatus, ApproveResponse, LinkResponse, MemberProfile, MemberSummary, MembersResponse } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, LinkCard, Load, Page, useAction } from "../components";
import { useApi } from "../hooks";
import { EventsTab } from "./AdminEvents";
import { InboundTab } from "./AdminInbound";
import { RemindersCard, TelegramCard } from "./AdminTelegram";
import { ExportCard, SheetsCard } from "./AdminExport";
import { AdminGuide } from "./AdminGuide";
import { ProfileCard } from "../Profile";
import { setSiteTheme, setSiteTitle, useAppearance } from "../site";
import { STYLES, type ThemeId } from "../../shared/themes";

type Tab = "events" | "inbound" | "pending" | "members" | "settings";

export function Admin(props: { token?: string }) {
  const base = `/api/admin/${props.token}`;
  const [members, reload] = useApi<MembersResponse>(`${base}/members`);
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return t === "settings" || t === "members" || t === "pending" ? t : "events";
  });

  if (members.state === "error" && members.code === "google_admin_required") return <GoogleAdminLogin />;
  if (members.state === "error" && members.code === "login_required") return <Login base={base} onDone={reload} />;
  if (members.state === "error" && members.code === "invalid_link") {
    return (
      <Page title="链接无效">
        <p>这个管理链接已失效。</p>
      </Page>
    );
  }

  return (
    <Page title="管理页">
      <Load result={members}>
        {(m) => (
          <>
            <div class="tabs">
              <button class={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>
                活动
              </button>
              <button class={tab === "inbound" ? "active" : ""} onClick={() => setTab("inbound")}>
                收款
              </button>
              <button class={tab === "pending" ? "active" : ""} onClick={() => { setTab("pending"); reload(); }}>
                待审核{m.pending.length > 0 && ` (${m.pending.length})`}
              </button>
              <button class={tab === "members" ? "active" : ""} onClick={() => { setTab("members"); reload(); }}>
                成员
              </button>
              <button class={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
                设置
              </button>
            </div>
            {tab === "events" && <EventsTab base={base} members={m.active} />}
            {tab === "inbound" && <InboundTab base={base} />}
            {tab === "pending" && <Pending base={base} list={m.pending} onChange={reload} />}
            {tab === "members" && <Members base={base} data={m} onChange={reload} />}
            {tab === "settings" && <Settings base={base} viaGoogle={props.token === "google"} />}
          </>
        )}
      </Load>
    </Page>
  );
}

/** /admin/google without the bound Google account signed in (or with a different one). */
function GoogleAdminLogin() {
  const [session] = useApi<{ signedIn: boolean; email: string | null }>("/api/auth/session");
  const other = session.state === "ok" && session.data.signedIn ? session.data.email : null;
  return (
    <Page title="管理员登录">
      <Card>
        {other && <p class="error">当前登录的 Google 账号 {other} 不是管理员绑定的账号。</p>}
        <button class="button block" onClick={() => location.assign("/api/auth/google?next=/admin/google")}>
          {other ? "换一个 Google 账号登录" : "使用 Google 登录"}
        </button>
        <p class="muted small">只有在管理页「设置」里绑定过的那个 Google 账号能进。没绑定的话，请用管理链接和密码登录。</p>
      </Card>
    </Page>
  );
}

function Login(props: { base: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  async function submit(e: Event) {
    e.preventDefault();
    if (await run(() => api(`${props.base}/login`, { password }))) props.onDone();
  }
  return (
    <Page title="管理员登录">
      <Card>
        <form onSubmit={submit}>
          <Field label="管理密码" type="password" value={password} onInput={setPassword} autocomplete="current-password" />
          {error && <p class="error">{error}</p>}
          <button class="button block" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </button>
          <p class="muted small">登录后这台设备 30 天内不用再输密码。</p>
        </form>
      </Card>
    </Page>
  );
}

/** A member's name and details; with onOpen the name opens their 个人信息. */
const who = (m: MemberSummary, onOpen?: (m: MemberSummary) => void) => {
  const name = (
    <>
      <span class="who-name">{m.username}</span>
      {m.adminNote && <span class="note">备注：{m.adminNote}</span>}
    </>
  );
  return (
    <div class="who">
      {onOpen ? (
        <button class="who-link" onClick={() => onOpen(m)}>
          {name}
        </button>
      ) : (
        name
      )}
      {m.isOwner && <span class="badge">管理员</span>}
      <small>
        {m.id} · 微信：{m.wechatAccount || m.wechatNickname}
        {m.applicantName && ` · 身份：${m.applicantName}`}
        {m.googleEmail && ` · Google：${m.googleEmail}`}
        {!m.googleEmail && m.email && ` · 邮箱：${m.email}`}
      </small>
    </div>
  );
};

/** 成员详情: the member's 个人信息 as they see it, plus the admin-only 备注名. */
function MemberDetail(props: { base: string; id: string; onBack: () => void; onChange: () => void }) {
  const base = `${props.base}/members/${props.id}`;
  const [res, reload] = useApi<MemberProfile>(`${base}/profile`);
  return (
    <>
      <button class="back" onClick={props.onBack}>
        ‹ 成员
      </button>
      <Load result={res}>
        {(p) => (
          <ProfileCard
            profile={p}
            base={base}
            mode="admin"
            onChange={() => {
              reload();
              props.onChange();
            }}
          />
        )}
      </Load>
    </>
  );
}

/** What happened to the email sent on approval: Google applicants get a note, email applicants their link. */
function approvalEmailMessage(status?: ApprovalEmailStatus, byEmail = false): string {
  const what = byEmail ? "专属链接" : "审核通知";
  if (status === "sent") return byEmail ? "专属链接已发到对方的邮箱。" : "审核通知已发送至对方的 Google 邮箱。";
  if (status === "not_configured") return `成员已通过审核，但邮件服务尚未配置，${what}没有发出。配置后可在成员列表重试，或者把链接私发给对方。`;
  if (status === "failed") return `成员已通过审核，但${what}邮件发送失败。可以在成员列表重试，或者把链接私发给对方。`;
  return "成员已通过审核，可以使用 Google 账号登录。";
}

function Pending(props: { base: string; list: MemberSummary[]; onChange: () => void }) {
  const [issued, setIssued] = useState<{ name: string; link: string | null; googleEmail: string | null; email?: string | null; emailStatus?: ApprovalEmailStatus } | null>(null);
  const { busy, error, run } = useAction();

  async function approve(m: MemberSummary) {
    const r = await run(() => api<ApproveResponse>(`${props.base}/members/${m.id}/approve`, {}));
    if (r) {
      setIssued({ name: m.username, ...r });
      props.onChange();
    }
  }
  async function reject(m: MemberSummary) {
    if (!confirm(`确定拒绝并删除 ${m.username} 的申请吗？`)) return;
    if (await run(() => api(`${props.base}/members/${m.id}/reject`, {}))) props.onChange();
  }

  return (
    <>
      {issued && (
        <Card>
          {issued.link ? (
            <>
              <LinkCard
                title={`${issued.name} 的专属链接`}
                link={issued.link}
                note={issued.email ? `已自动发到 ${issued.email}；对方没收到时，可以把链接或二维码私发给对方。` : "通过微信私聊发给对方（链接或二维码都可以）。"}
              />
              {issued.email && <p role="status">{approvalEmailMessage(issued.emailStatus, true)}</p>}
            </>
          ) : (
            <>
              <h2>已通过 {issued.name}</h2>
              <p>
                对方是用 Google（{issued.googleEmail}）申请的，不用发链接：用这个 Google 账号登录网站就能报名。
              </p>
              <p role="status">{approvalEmailMessage(issued.emailStatus)}</p>
              <p class="muted small">需要备用链接的话，可以在「成员」里生成。</p>
            </>
          )}
          <button class="button secondary block" onClick={() => setIssued(null)}>
            完成
          </button>
        </Card>
      )}
      <Card title="待审核申请">
        {error && <p class="error">{error}</p>}
        {props.list.length === 0 && <Empty>没有待审核的申请</Empty>}
        {props.list.map((m) => (
          <div class="row" key={m.id}>
            <div>
              {who(m)}
              {m.applicationMessage && <p class="application-message">留言：{m.applicationMessage}</p>}
            </div>
            <div class="actions">
              <button class="button" disabled={busy} onClick={() => approve(m)}>
                通过
              </button>
              <button class="button danger" disabled={busy} onClick={() => reject(m)}>
                拒绝
              </button>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

function Members(props: { base: string; data: MembersResponse; onChange: () => void }) {
  const [shown, setShown] = useState<{ name: string; link: string; fresh: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const [emailMessage, setEmailMessage] = useState("");
  async function retryEmail(m: MemberSummary) {
    const r = await run(() => api<{ emailStatus: ApprovalEmailStatus }>(`${props.base}/members/${m.id}/approval-email`, {}));
    if (r) { setEmailMessage(approvalEmailMessage(r.emailStatus, !m.googleEmail)); props.onChange(); }
  }
  const openMember = (m: MemberSummary) => setOpen(m.id);

  async function view(m: MemberSummary) {
    const r = await run(() => api<LinkResponse>(`${props.base}/members/${m.id}/link`));
    if (r) setShown({ name: m.username, link: r.link, fresh: false });
  }
  async function regenerate(m: MemberSummary) {
    if (!confirm(`重新生成后，${m.username} 的旧链接会立即失效。继续吗？`)) return;
    const r = await run(() => api<LinkResponse>(`${props.base}/members/${m.id}/regenerate`, {}));
    if (r) setShown({ name: m.username, link: r.link, fresh: true });
  }
  async function deactivate(m: MemberSummary) {
    if (!confirm(`停用后 ${m.username} 不能再报名，正在报名中的活动会被取消报名；他的链接还能用来付清欠款。继续吗？`)) return;
    if (await run(() => api(`${props.base}/members/${m.id}/deactivate`, {}))) props.onChange();
  }
  /** For members disabled before links were kept: a fresh link so they can pay what they owe. */
  async function newLink(m: MemberSummary) {
    const r = await run(() => api<LinkResponse>(`${props.base}/members/${m.id}/regenerate`, {}));
    if (!r) return;
    setShown({ name: m.username, link: r.link, fresh: true });
    props.onChange();
  }
  async function reactivate(m: MemberSummary) {
    if (!confirm(`恢复 ${m.username} 为正常成员？`)) return;
    const r = await run(() => api<{ link: string | null }>(`${props.base}/members/${m.id}/reactivate`, {}));
    if (!r) return;
    if (r.link) setShown({ name: m.username, link: r.link, fresh: true });
    props.onChange();
  }
  async function remove(m: MemberSummary) {
    if (!confirm(`删除 ${m.username}？删除后他的专属链接永久失效，不能恢复；以前的记录会保留。`)) return;
    if (await run(() => api(`${props.base}/members/${m.id}/delete`, {}))) props.onChange();
  }

  if (open) return <MemberDetail base={props.base} id={open} onBack={() => setOpen(null)} onChange={props.onChange} />;

  return (
    <>
      {shown && (
        <Card>
          <LinkCard
            title={`${shown.name} 的专属链接`}
            link={shown.link}
            note={shown.fresh ? "已生成新链接，旧链接已失效。请重新发给对方。" : undefined}
          />
          <button class="button secondary block" onClick={() => setShown(null)}>
            关闭
          </button>
        </Card>
      )}
      <Card title={`成员（${props.data.active.length}）`}>
        {emailMessage && <p role="status">{emailMessage}</p>}
        {error && <p class="error">{error}</p>}
        {props.data.active.length === 0 && <Empty>还没有成员</Empty>}
        {props.data.active.map((m) => (
          <div class="row" key={m.id}>
            {who(m, openMember)}
            <div class="actions">
              {(m.googleEmail || m.email) && m.approvalEmailStatus && m.approvalEmailStatus !== "sent" && <button class="button secondary" disabled={busy} onClick={() => retryEmail(m)}>重试审核邮件</button>}
              {m.hasLink && <button class="button secondary" disabled={busy} onClick={() => view(m)}>
                链接
              </button>}
              <button class="button secondary" disabled={busy} onClick={() => regenerate(m)}>
                {m.hasLink ? "重新生成" : "生成备用链接"}
              </button>
              {!m.isOwner && (
                <button class="button danger" disabled={busy} onClick={() => deactivate(m)}>
                  停用
                </button>
              )}
            </div>
          </div>
        ))}
      </Card>
      {props.data.inactive.length > 0 && (
        <Card>
          <details class="fold">
            <summary>已停用（{props.data.inactive.length}）</summary>
            <p class="muted small">已停用的成员不能报名，但还能打开专属链接付清欠款。</p>
            {props.data.inactive.map((m) => (
              <div class="row" key={m.id}>
                <div class="who">
                  <button class="who-link" onClick={() => openMember(m)}>
                    <span class="who-name">{m.username}</span>
                    {m.adminNote && <span class="note">备注：{m.adminNote}</span>}
                  </button>
                  <small>
                    {m.id} · {m.wechatNickname}
                    {m.owingCents > 0 && <span class="error"> · 欠 ${(m.owingCents / 100).toFixed(2)}</span>}
                  </small>
                </div>
                <div class="actions">
                  {m.hasLink ? (
                    <button class="button secondary" disabled={busy} onClick={() => view(m)}>
                      链接
                    </button>
                  ) : (
                    <button class="button secondary" disabled={busy} onClick={() => newLink(m)}>
                      生成链接
                    </button>
                  )}
                  <button class="button secondary" disabled={busy} onClick={() => reactivate(m)}>
                    恢复
                  </button>
                  <button class="button danger" disabled={busy || m.owingCents > 0} onClick={() => remove(m)}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </details>
        </Card>
      )}
      {props.data.deleted.length > 0 && (
        <Card>
          <details class="fold">
            <summary>已删除（{props.data.deleted.length}）</summary>
            <p class="muted small">专属链接已失效；以前的报名和付款记录仍然保留在统计和导出里。</p>
            {props.data.deleted.map((m) => (
              <div class="row" key={m.id}>
                {who(m, openMember)}
              </div>
            ))}
          </details>
        </Card>
      )}
    </>
  );
}

function Settings(props: { base: string; viaGoogle: boolean }) {
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
      await api("/api/auth/logout", {}).catch(() => undefined);
      location.assign("/login");
      return;
    }
    await api(`${props.base}/logout`, {}).catch(() => undefined);
    location.reload();
  }

  if (sub === "sheets") {
    return (
      <>
        <button class="back" onClick={() => setSub(null)}>
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
        <button class="menu-row" onClick={() => setSub("sheets")}>
          <span>
            <strong>Google 表格同步</strong>
            <small>每天把数据备份到你自己的 Google 表格</small>
          </span>
          <span class="chevron">›</span>
        </button>
      </Card>
      <GoogleAdminCard base={props.base} viaGoogle={props.viaGoogle} />
      <Card title="修改管理密码">
        <form onSubmit={changePassword}>
          <Field label="当前密码" type="password" value={current} onInput={setCurrent} autocomplete="current-password" />
          <Field label="新密码" type="password" value={next} onInput={setNext} autocomplete="new-password" />
          <Field label="再输一次新密码" type="password" value={again} onInput={setAgain} autocomplete="new-password" />
          {pw.error && <p class="error">{pw.error}</p>}
          <button class="button block" disabled={pw.busy}>
            保存新密码
          </button>
          <p class="muted small">修改后所有设备都会退出登录。忘记密码时，改 GitHub 里的 ADMIN_PASSWORD 并重新部署即可重置。</p>
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
            <button class="button secondary block" disabled={link.busy} onClick={rotate}>
              重新生成管理链接
            </button>
          </>
        )}
      </Card>
      <BackupKey base={props.base} />
      <button class="button secondary block" onClick={logout}>
        退出登录
      </button>
      <AdminGuide base={props.base} />
      <ResetAll base={props.base} />
    </>
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
        TOKEN_KEY 用来加密保存成员链接和管理链接，Cloudflare 里看不到它的值。把它发到你的 Telegram，存进密码管理器后删掉那条消息。
      </p>
      {done ? (
        <p>已发送到 Telegram。</p>
      ) : (
        <form onSubmit={submit}>
          <Field label="管理密码" type="password" value={password} onInput={setPassword} autocomplete="current-password" />
          {error && <p class="error">{error}</p>}
          <button class="button secondary block" disabled={busy || !password}>
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
    if (confirm("清空后，所有成员、活动、报名、付款记录和设置都会被删除，网站回到初次设置状态。确定要继续吗？")) setOpen(true);
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
          <p class="muted small">把网站重置成全新状态。只保留管理密码，清空后用它在 /admin 重新做初次设置。</p>
          <button class="button danger block" onClick={start}>
            清空所有数据
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p class="error">所有成员、活动、报名、付款记录、设置都会被删除，管理链接和所有成员链接都会失效。</p>
          <Field label={`请输入「${RESET_PHRASE}」`} value={phrase} onInput={setPhrase} />
          <Field label="管理密码" type="password" value={password} onInput={setPassword} autocomplete="current-password" />
          {error && <p class="error">{error}</p>}
          <button class="button danger block" disabled={busy || phrase !== RESET_PHRASE || !password}>
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
        <input type="checkbox" role="switch" checked={board} disabled={busy} onChange={(e) => toggleBoard((e.target as HTMLInputElement).checked)} />
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
            <button class="link-button" onClick={() => setEditing(true)}>
              🔒 修改收款设置（需要管理密码）
            </button>
          </Card>
        );
      }}
    </Load>
  );
}

function PaymentForm(props: { base: string; initial: GeneralSettings; first: boolean; onDone: () => void; onCancel?: () => void }) {
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
        <Field label="你的 Zelle 账号（选填）" value={zelle} onInput={setZelle} hint="手机号或邮箱，显示在付款页作为备选" />
        <Field label="管理密码" type="password" value={password} onInput={setPassword} autocomplete="current-password" hint="为防止误改，保存收款设置需要输入管理密码" />
        {error && <p class="error">{error}</p>}
        <button class="button block" disabled={busy || !password}>
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
  const signIn = () => location.assign(`/api/auth/google?next=${encodeURIComponent(`${location.pathname}?tab=settings`)}`);
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
                已绑定 <strong>{g.bound || "Google 账号"}</strong>。用这个账号登录后，在首页或 /admin 就能直接进入管理页，不用链接和密码。
              </p>
              {error && <p class="error">{error}</p>}
              <button class="button secondary block" disabled={busy} onClick={unbind}>
                解除绑定
              </button>
            </>
          ) : (
            <>
              <p class="muted">绑定一个 Google 账号（只能一个），以后用它登录就能直接进入管理页。管理链接和密码仍然可用。</p>
              {g.current?.holder ? (
                <p class="error">
                  当前登录的 {g.current.email} 已经属于成员「{g.current.holder}」，一个 Google 账号只能对应一个人。请换一个账号。
                </p>
              ) : g.current ? (
                <p>当前浏览器登录的 Google 账号：{g.current.email}</p>
              ) : null}
              {error && <p class="error">{error}</p>}
              {g.current && !g.current.holder ? (
                <button class="button block" disabled={busy} onClick={bind}>
                  绑定 {g.current.email}
                </button>
              ) : (
                <button class="button secondary block" onClick={signIn}>
                  {g.current ? "换一个 Google 账号" : "先登录 Google"}
                </button>
              )}
              <p class="muted small">请给这个 Google 账号开启两步验证：绑定后它就等于管理员钥匙。</p>
            </>
          )
        }
      </Load>
    </Card>
  );
}
