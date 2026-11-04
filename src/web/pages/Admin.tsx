import { useEffect, useState } from "preact/hooks";
import type {
  AuditEntry,
  ApprovalEmailStatus,
  ApproveResponse,
  LinkResponse,
  MemberProfile,
  MemberSummary,
  MembersResponse,
  OrganizersBlock,
  RevokeImpact,
} from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, LinkCard, Load, Page, useAction } from "../components";
import { useApi } from "../hooks";
import { EventsTab } from "./AdminEvents";
import { InboundTab } from "./AdminInbound";
import { AdminRoleSettings, OrganizerSettings, Settings } from "./AdminSettings";
import { ProfileCard } from "../Profile";
import { has, revokeSummary } from "../organizers";
import { t, fmtInstant } from "../i18n";
import { usd } from "../../shared/settle";

type Tab = "events" | "inbound" | "pending" | "members" | "settings";

export function Admin(props: { token?: string }) {
  const base = `/api/admin/${props.token}`;
  const [members, reload] = useApi<MembersResponse>(`${base}/members`);
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return t === "settings" || t === "members" || t === "pending" ? t : "events";
  });

  if (members.state === "error" && members.code === "developer_login_required")
    return (
      <Page title={t("开发者登录")}>
        <a class="button block" href="/login">
          {t("前往开发者登录")}
        </a>
      </Page>
    );
  if (members.state === "error" && members.code === "google_admin_required") return <GoogleAdminLogin />;
  if (members.state === "error" && members.code === "login_required") return <Login base={base} onDone={reload} />;
  if (members.state === "error" && members.code === "invalid_link") {
    return (
      <Page title={t("链接无效")}>
        <p>{t("这个管理链接已失效。")}</p>
      </Page>
    );
  }

  return (
    <Page title={t("管理页")}>
      <Load result={members}>
        {(m) => (
          <>
            <div class="tabs">
              <button type="button" class={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>
                {t("活动")}
              </button>
              <button type="button" class={tab === "inbound" ? "active" : ""} onClick={() => setTab("inbound")}>
                {t("收款")}
              </button>
              <button
                type="button"
                class={tab === "pending" ? "active" : ""}
                onClick={() => {
                  setTab("pending");
                  reload();
                }}
              >
                {t("待审核")}
                {m.pending.length > 0 && ` (${m.pending.length})`}
              </button>
              <button
                type="button"
                class={tab === "members" ? "active" : ""}
                onClick={() => {
                  setTab("members");
                  reload();
                }}
              >
                {t("成员")}
              </button>
              <button type="button" class={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
                {t("设置")}
              </button>
            </div>
            {tab === "events" && (
              <EventsTab base={base} members={m.active} organizers={m.organizers} viewer={m.viewer} />
            )}
            {tab === "inbound" && <InboundTab base={base} owner={has(m.viewer, "owner")} />}
            {tab === "pending" && (
              <Pending base={base} list={m.pending} readOnly={!has(m.viewer, "group")} onChange={reload} />
            )}
            {tab === "members" && <Members base={base} data={m} onChange={reload} />}
            {tab === "settings" &&
              (has(m.viewer, "owner") ? (
                <Settings base={base} viaGoogle={props.token === "google"} />
              ) : has(m.viewer, "group") ? (
                <AdminRoleSettings base={base} />
              ) : (
                <OrganizerSettings base={base} />
              ))}
          </>
        )}
      </Load>
    </Page>
  );
}

/** /admin/google without the bound Google account (or an admin's or organizer's) signed in, or with another one. */
function GoogleAdminLogin() {
  const [session] = useApi<{ signedIn: boolean; email: string | null; organizers?: boolean }>("/api/auth/session");
  const other = session.state === "ok" && session.data.signedIn ? session.data.email : null;
  // With the 组织者 feature on, admins and organizers come in this way too.
  const organizers = session.state === "ok" && !!session.data.organizers;
  return (
    <Page title={organizers ? t("管理页登录") : t("群主登录")}>
      <Card>
        {other && (
          <p class="error">
            {organizers
              ? t("当前登录的 Google 账号 {email} 不是群主绑定的账号，也不是管理员或组织者。", { email: other })
              : t("当前登录的 Google 账号 {email} 不是群主绑定的账号。", { email: other })}
          </p>
        )}
        <button
          type="button"
          class="button block"
          onClick={() => location.assign("/api/auth/google?next=/admin/google")}
        >
          {other ? t("换一个 Google 账号登录") : t("使用 Google 登录")}
        </button>
        <p class="muted small">
          {organizers
            ? t(
                "群主在管理页「设置」里绑定过的 Google 账号，以及管理员和组织者自己的 Google 账号能进。群主没绑定的话，请用管理链接和密码登录。",
              )
            : t("只有在管理页「设置」里绑定过的那个 Google 账号能进。没绑定的话，请用管理链接和密码登录。")}
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
    <Page title={t("群主登录")}>
      <Card>
        <form onSubmit={submit}>
          <Field
            label={t("群主密码")}
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button block" disabled={busy}>
            {busy ? t("登录中…") : t("登录")}
          </button>
          <p class="muted small">{t("登录后这台设备 30 天内不用再输密码。")}</p>
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
      {m.adminNote && <span class="note">{t("备注：{note}", { note: m.adminNote })}</span>}
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
      {m.isOwner && <span class="badge">{t("群主")}</span>}
      {m.isAdmin && <span class="badge">{t("管理员")}</span>}
      {m.isOrganizer && <span class="badge">{t("组织者")}</span>}
      <small>
        {m.id} · {t("微信：{name}", { name: m.wechatAccount || m.wechatNickname })}
        {m.applicantName && t(" · 身份：{applicantName}", { applicantName: m.applicantName })}
        {m.googleEmail && ` · Google：${m.googleEmail}`}
        {!m.googleEmail && m.email && t(" · 邮箱：{email}", { email: m.email })}
      </small>
    </div>
  );
};

/** 成员详情: the member's 个人信息 as they see it, plus the admin-only 备注名. */
function MemberDetail(props: {
  base: string;
  id: string;
  readOnly: boolean;
  organizers: boolean;
  onBack: () => void;
  onChange: () => void;
}) {
  const base = `${props.base}/members/${props.id}`;
  const [res, reload] = useApi<MemberProfile>(`${base}/profile`);
  return (
    <>
      <button type="button" class="back" onClick={props.onBack}>
        {t("‹ 成员")}
      </button>
      <Load result={res}>
        {(p) => (
          <ProfileCard
            profile={p}
            base={base}
            noteReadOnly={props.readOnly}
            organizers={props.organizers}
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
  const what = byEmail ? t("专属链接") : t("审核通知");
  if (status === "sent") return byEmail ? t("专属链接已发到对方的邮箱。") : t("审核通知已发送至对方的 Google 邮箱。");
  if (status === "not_configured")
    return t("成员已通过审核，但邮件服务尚未配置，{what}没有发出。配置后可在成员列表重试，或者把链接私发给对方。", {
      what,
    });
  if (status === "failed")
    return t("成员已通过审核，但{what}邮件发送失败。可以在成员列表重试，或者把链接私发给对方。", { what });
  return t("成员已通过审核，可以使用 Google 账号登录。");
}

/** 待审核: the Owner and admins approve; organizers see it read-only (Ke Li 2026-10-04): the same list, without 通过 / 拒绝. */
function Pending(props: { base: string; list: MemberSummary[]; readOnly: boolean; onChange: () => void }) {
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
    if (!confirm(t("确定拒绝并删除 {name} 的申请吗？", { name: m.username }))) return;
    if (await run(() => api(`${props.base}/members/${m.id}/reject`, {}))) props.onChange();
  }

  return (
    <>
      {issued && (
        <Card>
          {issued.link ? (
            <>
              <LinkCard
                title={t("{name} 的专属链接", { name: issued.name })}
                link={issued.link}
                note={
                  issued.email
                    ? t("已自动发到 {email}；对方没收到时，可以把链接或二维码私发给对方。", { email: issued.email })
                    : t("通过微信私聊发给对方（链接或二维码都可以）。")
                }
              />
              {issued.email && <p role="status">{approvalEmailMessage(issued.emailStatus, true)}</p>}
            </>
          ) : (
            <>
              <h2>{t("已通过 {name}", { name: issued.name })}</h2>
              <p>
                {t("对方是用 Google（{email}）申请的，不用发链接：用这个 Google 账号登录网站就能报名。", {
                  email: issued.googleEmail ?? "",
                })}
              </p>
              <p role="status">{approvalEmailMessage(issued.emailStatus)}</p>
            </>
          )}
          <button type="button" class="button secondary block" onClick={() => setIssued(null)}>
            {t("完成")}
          </button>
        </Card>
      )}
      <Card title={t("待审核申请")}>
        {props.readOnly && <p class="muted small">{t("只有群主和管理员可以通过或拒绝申请。")}</p>}
        {error && <p class="error">{error}</p>}
        {props.list.length === 0 && <Empty>{t("没有待审核的申请")}</Empty>}
        {props.list.map((m) => (
          <div class="row" key={m.id}>
            <div>
              {who(m)}
              {m.applicationMessage && (
                <p class="application-message">{t("留言：{message}", { message: m.applicationMessage })}</p>
              )}
            </div>
            {!props.readOnly && (
              <div class="actions">
                <button type="button" class="button" disabled={busy} onClick={() => approve(m)}>
                  {t("通过")}
                </button>
                <button type="button" class="button danger" disabled={busy} onClick={() => reject(m)}>
                  {t("拒绝")}
                </button>
              </div>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

/**
 * 还没用 Google 登录: 专属链接 are on their way out (Ke Li 2026-11-04), so the Owner and admins see
 * who still has no Google account bound. The Owner gets in with the admin link and is left out.
 */
function GoogleProgress(props: { data: MembersResponse }) {
  const missing = props.data.active.filter((m) => !m.isOwner && !m.googleEmail);
  const inactive = props.data.inactive.filter((m) => !m.googleEmail).length;
  const links = [...props.data.active, ...props.data.inactive].filter((m) => m.hasLink).length;
  return (
    <Card title={missing.length ? t("还没用 Google 登录（{n}）", { n: missing.length }) : t("Google 登录")}>
      {missing.length === 0 ? (
        <p>{t("✓ 所有成员都已绑定 Google 账号。")}</p>
      ) : (
        <>
          <p class="google-missing">
            {missing.map((m) => (m.adminNote ? `${m.username}（${m.adminNote}）` : m.username)).join("、")}
          </p>
          <p class="muted small">{t("他们打开自己的专属链接，在个人信息里点「绑定 Google 账号」就行。")}</p>
        </>
      )}
      {inactive > 0 && <p class="muted small">{t("另有 {n} 个已停用的成员没有绑定 Google。", { n: inactive })}</p>}
      <p class="muted small">
        {links ? t("现在还有 {links} 个专属链接有效。", { links }) : t("已经没有有效的专属链接。")}
      </p>
    </Card>
  );
}

/**
 * 成员: the Owner and admins manage it; organizers see the same lists read-only (no links, notes,
 * appointing or 停用). Admins leave the Owner's and admins' rows alone (access.ts memberTarget).
 */
function Members(props: { base: string; data: MembersResponse; onChange: () => void }) {
  const readOnly = !has(props.data.viewer, "group");
  /** Appointing, demoting and revoking admins, and deleting members: the Owner's alone. */
  const ownerView = has(props.data.viewer, "owner");
  /** Links, 停用 and the rest on this row: an admin may not act on the Owner or an admin, themselves included. */
  const mayActOn = (m: MemberSummary) => ownerView || (!m.isOwner && !m.isAdmin);
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
    if (!confirm(t("重新生成后，{name} 的旧链接会立即失效。继续吗？", { name: m.username }))) return;
    const r = await run(() => api<LinkResponse>(`${props.base}/members/${m.id}/regenerate`, {}));
    if (r) setShown({ name: m.username, link: r.link, fresh: true });
  }
  async function deactivate(m: MemberSummary) {
    // No preview (they stopped being an organizer meanwhile): 停用 still works, so ask without it.
    const title = m.isAdmin ? t("管理员") : t("组织者");
    const impact =
      m.isOrganizer || m.isAdmin
        ? await api<{ events: RevokeImpact[] }>(`${props.base}/members/${m.id}/revoke`).then(
            (r) => r.events,
            () => null,
          )
        : null;
    const revoke = impact
      ? t("\n\n{name} 是{title}，停用会先撤销{title}身份。{revokeSummary}", {
          name: m.username,
          title,
          revokeSummary: revokeSummary(impact),
        })
      : "";
    if (
      !confirm(
        t("停用后 {name} 不能再报名，正在报名中的活动会被取消报名；他的链接还能用来付清欠款。{revoke}\n\n继续吗？", {
          name: m.username,
          revoke,
        }),
      )
    )
      return;
    const r = await run(() =>
      api<{ revoked: { emailStatus: string } | null }>(`${props.base}/members/${m.id}/deactivate`, {}),
    );
    if (!r) return;
    if (r.revoked) setEmailMessage(revokeEmailMessage(m.username, r.revoked.emailStatus, title));
    props.onChange();
  }
  async function revokePreview(m: { id: string }) {
    const r = await run(() => api<{ events: RevokeImpact[] }>(`${props.base}/members/${m.id}/revoke`));
    return r ? r.events : null;
  }
  async function appoint(m: MemberSummary) {
    if (
      !confirm(
        t(
          "把 {name} 设为组织者？\n\n他用 Google 登录后可以发起活动、管理自己的活动，钱付到他自己的 Venmo；也能只读查看成员和待审核。",
          { name: m.username },
        ),
      )
    )
      return;
    const r = await run(() => api<{ emailStatus: string }>(`${props.base}/members/${m.id}/appoint`, {}));
    if (!r) return;
    setEmailMessage(
      r.emailStatus === "sent"
        ? t("{name} 已成为组织者，已发邮件告诉他用 Google 登录后在「管理」里发起活动。", { name: m.username })
        : t(
            "{name} 已成为组织者，但{emailProblem}。请你自己告诉他：用 Google 登录后打开 {origin}/admin/google，先填好收款设置。",
            { name: m.username, emailProblem: emailProblem(r.emailStatus), origin: location.origin },
          ),
    );
    props.onChange();
  }
  async function revoke(m: { id: string; username: string; admin: boolean }) {
    const title = m.admin ? t("管理员") : t("组织者");
    const events = await revokePreview(m);
    if (!events) return;
    if (
      !confirm(
        t("撤销 {name} 的{title}身份？{revokeSummary}\n\n撤销后他马上进不了管理页，系统会发邮件告诉他。", {
          name: m.username,
          title,
          revokeSummary: revokeSummary(events),
        }),
      )
    )
      return;
    const done = await run(() => api<{ emailStatus: string }>(`${props.base}/members/${m.id}/revoke`, {}));
    if (!done) return;
    setEmailMessage(revokeEmailMessage(m.username, done.emailStatus, title));
    props.onChange();
  }
  async function appointAdmin(m: MemberSummary) {
    const kept = m.isOrganizer ? t("\n\n他原来的活动、收款设置和 Telegram 都保留。") : "";
    if (
      !confirm(
        t(
          "把 {name} 设为管理员？\n\n他用 Google 登录后可以像群主一样管理整个群：审核和管理成员、任命组织者、管理所有活动和付款、修改设置、导出数据。只有任命管理员、清空数据、密钥和备份、永久删除仍然只有你能做。{kept}",
          { name: m.username, kept },
        ),
      )
    )
      return;
    const r = await run(() => api<{ emailStatus: string }>(`${props.base}/members/${m.id}/appoint-admin`, {}));
    if (!r) return;
    setEmailMessage(
      r.emailStatus === "sent"
        ? t("{name} 已成为管理员，已发邮件告诉他用 Google 登录后打开管理页。", { name: m.username })
        : t("{name} 已成为管理员，但{emailProblem}。请你自己告诉他：用 Google 登录后打开 {origin}/admin/google。", {
            name: m.username,
            emailProblem: emailProblem(r.emailStatus),
            origin: location.origin,
          }),
    );
    props.onChange();
  }
  async function demoteAdmin(m: MemberSummary) {
    if (
      !confirm(
        t(
          "把 {name} 从管理员改为组织者？\n\n他只能管理自己的活动，不再管理成员、别人的活动和设置。他的活动、收款设置和 Telegram 都保留。",
          { name: m.username },
        ),
      )
    )
      return;
    const r = await run(() => api<{ emailStatus: string }>(`${props.base}/members/${m.id}/demote-admin`, {}));
    if (!r) return;
    setEmailMessage(
      r.emailStatus === "sent"
        ? t("{name} 已改为组织者，并发邮件告诉了他。", { name: m.username })
        : t("{name} 已改为组织者，但{emailProblem}。", { name: m.username, emailProblem: emailProblem(r.emailStatus) }),
    );
    props.onChange();
  }
  /** For members disabled before links were kept: a fresh link so they can pay what they owe. */
  async function newLink(m: MemberSummary) {
    const r = await run(() => api<LinkResponse>(`${props.base}/members/${m.id}/regenerate`, {}));
    if (!r) return;
    setShown({ name: m.username, link: r.link, fresh: true });
    props.onChange();
  }
  async function reactivate(m: MemberSummary) {
    if (!confirm(t("恢复 {name} 为正常成员？", { name: m.username }))) return;
    const r = await run(() => api<{ link: string | null }>(`${props.base}/members/${m.id}/reactivate`, {}));
    if (!r) return;
    if (r.link) setShown({ name: m.username, link: r.link, fresh: true });
    props.onChange();
  }
  async function remove(m: MemberSummary) {
    if (!confirm(t("删除 {name}？删除后他的专属链接永久失效，不能恢复；以前的记录会保留。", { name: m.username })))
      return;
    if (await run(() => api(`${props.base}/members/${m.id}/delete`, {}))) props.onChange();
  }

  if (open)
    return (
      <MemberDetail
        base={props.base}
        id={open}
        readOnly={readOnly}
        organizers={!!props.data.organizers}
        onBack={() => setOpen(null)}
        onChange={props.onChange}
      />
    );

  return (
    <>
      {shown && (
        <Card>
          <LinkCard
            title={t("{name} 的专属链接", { name: shown.name })}
            link={shown.link}
            note={shown.fresh ? t("已生成新链接，旧链接已失效。请重新发给对方。") : undefined}
          />
          <button type="button" class="button secondary block" onClick={() => setShown(null)}>
            {t("关闭")}
          </button>
        </Card>
      )}
      {props.data.organizers && (
        <Organizers
          block={props.data.organizers}
          ownerView={ownerView}
          busy={busy}
          onRevoke={(o) => revoke({ ...o, admin: o.role === "admin" })}
        />
      )}
      <GoogleProgress data={props.data} />
      <Card title={t("成员（{n}）", { n: props.data.active.length })}>
        {emailMessage && <p role="status">{emailMessage}</p>}
        {error && <p class="error">{error}</p>}
        {props.data.active.length === 0 && <Empty>{t("还没有成员")}</Empty>}
        {props.data.active.map((m) => (
          <div class="row" key={m.id}>
            {who(m, openMember)}
            {!readOnly && mayActOn(m) && (
              <div class="actions">
                {(m.googleEmail || m.email) && m.approvalEmailStatus && m.approvalEmailStatus !== "sent" && (
                  <button type="button" class="button secondary" disabled={busy} onClick={() => retryEmail(m)}>
                    {t("重试审核邮件")}
                  </button>
                )}
                {/* Bound to Google: no 专属链接 to show or make (Ke Li 2026-11-04). */}
                {!m.googleEmail && m.hasLink && (
                  <button type="button" class="button secondary" disabled={busy} onClick={() => view(m)}>
                    {t("链接")}
                  </button>
                )}
                {!m.googleEmail && (
                  <button type="button" class="button secondary" disabled={busy} onClick={() => regenerate(m)}>
                    {m.hasLink ? t("重新生成") : t("生成备用链接")}
                  </button>
                )}
                {props.data.organizers?.canManage && !m.isOwner && !m.isOrganizer && !m.isAdmin && (
                  <button type="button" class="button secondary" disabled={busy} onClick={() => appoint(m)}>
                    {t("设为组织者")}
                  </button>
                )}
                {props.data.organizers && ownerView && !m.isOwner && !m.isAdmin && (
                  <button type="button" class="button secondary" disabled={busy} onClick={() => appointAdmin(m)}>
                    {m.isOrganizer ? t("升为管理员") : t("设为管理员")}
                  </button>
                )}
                {props.data.organizers?.canManage && m.isOrganizer && (
                  <button
                    type="button"
                    class="button secondary"
                    disabled={busy}
                    onClick={() => revoke({ ...m, admin: false })}
                  >
                    {t("撤销组织者")}
                  </button>
                )}
                {props.data.organizers && ownerView && m.isAdmin && (
                  <>
                    <button type="button" class="button secondary" disabled={busy} onClick={() => demoteAdmin(m)}>
                      {t("降为组织者")}
                    </button>
                    <button
                      type="button"
                      class="button secondary"
                      disabled={busy}
                      onClick={() => revoke({ ...m, admin: true })}
                    >
                      {t("撤销管理员")}
                    </button>
                  </>
                )}
                {!m.isOwner && (
                  <button type="button" class="button danger" disabled={busy} onClick={() => deactivate(m)}>
                    {t("停用")}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>
      {props.data.inactive.length > 0 && (
        <Card>
          <details class="fold">
            <summary>{t("已停用（{n}）", { n: props.data.inactive.length })}</summary>
            <p class="muted small">{t("已停用的成员不能报名，但还能打开专属链接付清欠款。")}</p>
            {props.data.inactive.map((m) => (
              <div class="row" key={m.id}>
                <div class="who">
                  <button type="button" class="who-link" onClick={() => openMember(m)}>
                    <span class="who-name">{m.username}</span>
                    {m.adminNote && <span class="note">{t("备注：{note}", { note: m.adminNote })}</span>}
                  </button>
                  <small>
                    {m.id} · {m.wechatNickname}
                    {m.owingCents > 0 && (
                      <span class="error"> · {t("欠 {amount}", { amount: usd(m.owingCents) })}</span>
                    )}
                  </small>
                </div>
                {!readOnly && (
                  <div class="actions">
                    {m.googleEmail ? null : m.hasLink ? (
                      <button type="button" class="button secondary" disabled={busy} onClick={() => view(m)}>
                        {t("链接")}
                      </button>
                    ) : (
                      <button type="button" class="button secondary" disabled={busy} onClick={() => newLink(m)}>
                        {t("生成链接")}
                      </button>
                    )}
                    <button type="button" class="button secondary" disabled={busy} onClick={() => reactivate(m)}>
                      {t("恢复")}
                    </button>
                    {ownerView && (
                      <button
                        type="button"
                        class="button danger"
                        disabled={busy || m.owingCents > 0}
                        onClick={() => remove(m)}
                      >
                        {t("删除")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </details>
        </Card>
      )}
      {props.data.deleted.length > 0 && (
        <Card>
          <details class="fold">
            <summary>{t("已删除（{n}）", { n: props.data.deleted.length })}</summary>
            <p class="muted small">{t("专属链接已失效；以前的报名和付款记录仍然保留在统计和导出里。")}</p>
            {props.data.deleted.map((m) => (
              <div class="row" key={m.id}>
                {who(m, openMember)}
              </div>
            ))}
          </details>
        </Card>
      )}
      {!readOnly && <GroupLog base={props.base} />}
    </>
  );
}

/** 群操作记录: who did what to the group, newest first, loaded when opened and a page at a time. */
function GroupLog(props: { base: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <details class="fold" onToggle={(ev) => setOpen((ev.currentTarget as HTMLDetailsElement).open)}>
        <summary>{t("群操作记录")}</summary>
        {open && <GroupLogList base={props.base} />}
      </details>
    </Card>
  );
}

function GroupLogList(props: { base: string }) {
  const [pages, setPages] = useState<AuditEntry[][]>([]);
  const [more, setMore] = useState(true);
  const { busy, error, run } = useAction();
  async function next() {
    const flat = pages.flat();
    const last = flat[flat.length - 1];
    const r = await run(() =>
      api<{ entries: AuditEntry[]; more: boolean }>(`${props.base}/group-audit${last ? `?before=${last.id}` : ""}`),
    );
    if (!r) return;
    setPages((p) => [...p, r.entries]);
    setMore(r.more);
  }
  useEffect(() => {
    void next();
  }, []);
  const entries = pages.flat();
  return (
    <>
      {error && <p class="error">{error}</p>}
      {pages.length > 0 && entries.length === 0 && <Empty>{t("还没有记录")}</Empty>}
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
      {pages.length > 0 && more && (
        <button type="button" class="button secondary block" disabled={busy} onClick={next}>
          {t("显示更早的记录")}
        </button>
      )}
    </>
  );
}

/** Why an appointment or revoke email did not go out. */
function emailProblem(status: string): string {
  if (status === "failed") return t("通知邮件发送失败");
  if (status === "no_address") return t("他没有可以收信的邮箱，通知邮件没有发出");
  return t("邮件服务没有配置，通知邮件没有发出");
}

function revokeEmailMessage(name: string, status: string, title = t("组织者")): string {
  if (status === "sent") return t("已撤销 {name} 的{title}身份，并发邮件告诉了他。", { name, title });
  return t(
    "已撤销 {name} 的{title}身份，但{emailProblem}。请你自己告诉他：还在收款的活动钱继续付到他的账户，收到后和你核对；之后可以删掉 Venmo 邮件转发。",
    { name, title, emailProblem: emailProblem(status) },
  );
}

/**
 * 管理员和组织者 block at the top of the members page: the Owner, admins and (read-only) organizers
 * see it. Only the Owner revokes an admin.
 */
function Organizers(props: {
  block: OrganizersBlock;
  ownerView: boolean;
  busy: boolean;
  onRevoke: (o: { id: string; username: string; role: "admin" | "organizer" }) => void;
}) {
  const { list, former, canManage } = props.block;
  const admins = list.filter((o) => o.role === "admin").length;
  return (
    <Card title={admins > 0 ? t("管理员和组织者（{n}）", { n: list.length }) : t("组织者（{n}）", { n: list.length })}>
      {list.length === 0 && former.length === 0 && (
        <Empty>{canManage ? t("还没有组织者。在下面的成员列表点「设为组织者」。") : t("还没有组织者")}</Empty>
      )}
      {list.map((o) => (
        <div class="row" key={o.id}>
          <div class="who">
            <span class="who-name">{o.username}</span>
            {o.role === "admin" && <span class="badge">{t("管理员")}</span>}
            <small>
              {o.since && t("{time} 任命 · ", { time: fmtInstant(o.since) })}
              {o.paymentReady ? t("收款设置已填好") : <span class="error">{t("收款设置没填好")}</span>}
              {" · "}
              {o.quietBills > 0 ? (
                <span class="error">
                  {o.lastVenmoEmailAt
                    ? t("{time} 之后没收到 Venmo 邮件，但有 {n} 笔欠款，转发可能中断", {
                        time: fmtInstant(o.lastVenmoEmailAt),
                        n: o.quietBills,
                      })
                    : t("没收到 Venmo 邮件，但有 {n} 笔欠款，转发可能中断", { n: o.quietBills })}
                </span>
              ) : o.lastVenmoEmailAt ? (
                t("转发已生效（{time}）", { time: fmtInstant(o.lastVenmoEmailAt) })
              ) : (
                t("还没收到 Venmo 邮件")
              )}
              {" · "}
              {o.telegram ? t("Telegram 已连接") : t("Telegram 未连接")}
              {t(" · 负责 {events} 场未归档活动", { events: o.events })}
            </small>
          </div>
          {canManage && (o.role === "organizer" || props.ownerView) && (
            <div class="actions">
              <button type="button" class="button secondary" disabled={props.busy} onClick={() => props.onRevoke(o)}>
                {t("撤销")}
              </button>
            </div>
          )}
        </div>
      ))}
      {former.map((f) => (
        <div class="row" key={f.id}>
          <div class="who">
            <span class="who-name">{f.username}</span>
            <small>{t("已撤销，还有 {n} 场在收款", { n: f.collecting })}</small>
          </div>
        </div>
      ))}
    </Card>
  );
}
