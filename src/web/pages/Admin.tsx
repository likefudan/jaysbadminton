import { useState } from "preact/hooks";
import type {
  ApprovalEmailStatus,
  ApproveResponse,
  LinkResponse,
  MemberProfile,
  MemberSummary,
  MembersResponse,
} from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, LinkCard, Load, Page, useAction } from "../components";
import { useApi } from "../hooks";
import { EventsTab } from "./AdminEvents";
import { InboundTab } from "./AdminInbound";
import { Settings } from "./AdminSettings";
import { ProfileCard } from "../Profile";

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
              <button type="button" class={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>
                活动
              </button>
              <button type="button" class={tab === "inbound" ? "active" : ""} onClick={() => setTab("inbound")}>
                收款
              </button>
              <button
                type="button"
                class={tab === "pending" ? "active" : ""}
                onClick={() => {
                  setTab("pending");
                  reload();
                }}
              >
                待审核{m.pending.length > 0 && ` (${m.pending.length})`}
              </button>
              <button
                type="button"
                class={tab === "members" ? "active" : ""}
                onClick={() => {
                  setTab("members");
                  reload();
                }}
              >
                成员
              </button>
              <button type="button" class={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
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
        <button
          type="button"
          class="button block"
          onClick={() => location.assign("/api/auth/google?next=/admin/google")}
        >
          {other ? "换一个 Google 账号登录" : "使用 Google 登录"}
        </button>
        <p class="muted small">
          只有在管理页「设置」里绑定过的那个 Google 账号能进。没绑定的话，请用管理链接和密码登录。
        </p>
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
          <Field
            label="管理密码"
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button block" disabled={busy}>
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
        <button type="button" class="who-link" onClick={() => onOpen(m)}>
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
      <button type="button" class="back" onClick={props.onBack}>
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
  if (status === "not_configured")
    return `成员已通过审核，但邮件服务尚未配置，${what}没有发出。配置后可在成员列表重试，或者把链接私发给对方。`;
  if (status === "failed") return `成员已通过审核，但${what}邮件发送失败。可以在成员列表重试，或者把链接私发给对方。`;
  return "成员已通过审核，可以使用 Google 账号登录。";
}

function Pending(props: { base: string; list: MemberSummary[]; onChange: () => void }) {
  const [issued, setIssued] = useState<{
    name: string;
    link: string | null;
    googleEmail: string | null;
    email?: string | null;
    emailStatus?: ApprovalEmailStatus;
  } | null>(null);
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
                note={
                  issued.email
                    ? `已自动发到 ${issued.email}；对方没收到时，可以把链接或二维码私发给对方。`
                    : "通过微信私聊发给对方（链接或二维码都可以）。"
                }
              />
              {issued.email && <p role="status">{approvalEmailMessage(issued.emailStatus, true)}</p>}
            </>
          ) : (
            <>
              <h2>已通过 {issued.name}</h2>
              <p>对方是用 Google（{issued.googleEmail}）申请的，不用发链接：用这个 Google 账号登录网站就能报名。</p>
              <p role="status">{approvalEmailMessage(issued.emailStatus)}</p>
              <p class="muted small">需要备用链接的话，可以在「成员」里生成。</p>
            </>
          )}
          <button type="button" class="button secondary block" onClick={() => setIssued(null)}>
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
              <button type="button" class="button" disabled={busy} onClick={() => approve(m)}>
                通过
              </button>
              <button type="button" class="button danger" disabled={busy} onClick={() => reject(m)}>
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
    const r = await run(() =>
      api<{ emailStatus: ApprovalEmailStatus }>(`${props.base}/members/${m.id}/approval-email`, {}),
    );
    if (r) {
      setEmailMessage(approvalEmailMessage(r.emailStatus, !m.googleEmail));
      props.onChange();
    }
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
    if (!confirm(`停用后 ${m.username} 不能再报名，正在报名中的活动会被取消报名；他的链接还能用来付清欠款。继续吗？`))
      return;
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
          <button type="button" class="button secondary block" onClick={() => setShown(null)}>
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
              {(m.googleEmail || m.email) && m.approvalEmailStatus && m.approvalEmailStatus !== "sent" && (
                <button type="button" class="button secondary" disabled={busy} onClick={() => retryEmail(m)}>
                  重试审核邮件
                </button>
              )}
              {m.hasLink && (
                <button type="button" class="button secondary" disabled={busy} onClick={() => view(m)}>
                  链接
                </button>
              )}
              <button type="button" class="button secondary" disabled={busy} onClick={() => regenerate(m)}>
                {m.hasLink ? "重新生成" : "生成备用链接"}
              </button>
              {!m.isOwner && (
                <button type="button" class="button danger" disabled={busy} onClick={() => deactivate(m)}>
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
                  <button type="button" class="who-link" onClick={() => openMember(m)}>
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
                    <button type="button" class="button secondary" disabled={busy} onClick={() => view(m)}>
                      链接
                    </button>
                  ) : (
                    <button type="button" class="button secondary" disabled={busy} onClick={() => newLink(m)}>
                      生成链接
                    </button>
                  )}
                  <button type="button" class="button secondary" disabled={busy} onClick={() => reactivate(m)}>
                    恢复
                  </button>
                  <button
                    type="button"
                    class="button danger"
                    disabled={busy || m.owingCents > 0}
                    onClick={() => remove(m)}
                  >
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
