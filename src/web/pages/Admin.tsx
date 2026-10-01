import { useState } from "preact/hooks";
import { checkPassword } from "../../shared/rules";
import type { LinkResponse, MemberSummary, MembersResponse } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, LinkCard, Load, Page, useAction } from "../components";
import { useApi } from "../hooks";
import { EventsTab } from "./AdminEvents";
import { InboundTab } from "./AdminInbound";
import { RemindersCard, TelegramCard } from "./AdminTelegram";
import { ExportCard, SheetsCard } from "./AdminExport";
import { AdminGuide } from "./AdminGuide";
import { applyTheme, setSiteTitle } from "../site";
import { DEFAULT_THEME, THEMES } from "../../shared/themes";

type Tab = "events" | "inbound" | "pending" | "members" | "settings";

export function Admin(props: { token?: string }) {
  const base = `/api/admin/${props.token}`;
  const [members, reload] = useApi<MembersResponse>(`${base}/members`);
  const [tab, setTab] = useState<Tab>("events");

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
              <button class={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>
                待审核{m.pending.length > 0 && ` (${m.pending.length})`}
              </button>
              <button class={tab === "members" ? "active" : ""} onClick={() => setTab("members")}>
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
            {tab === "settings" && <Settings base={base} />}
          </>
        )}
      </Load>
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

const who = (m: MemberSummary) => (
  <div class="who">
    {m.username}
    {m.isOwner && <span class="badge">管理员</span>}
    <small>
      {m.id} · 微信：{m.wechatNickname}
    </small>
  </div>
);

function Pending(props: { base: string; list: MemberSummary[]; onChange: () => void }) {
  const [issued, setIssued] = useState<{ name: string; link: string } | null>(null);
  const { busy, error, run } = useAction();

  async function approve(m: MemberSummary) {
    const r = await run(() => api<LinkResponse>(`${props.base}/members/${m.id}/approve`, {}));
    if (r) {
      setIssued({ name: m.username, link: r.link });
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
          <LinkCard title={`${issued.name} 的专属链接`} link={issued.link} note="通过微信私聊发给对方（链接或二维码都可以）。" />
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
            {who(m)}
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
  const { busy, error, run } = useAction();

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
    if (!confirm(`停用后 ${m.username} 的链接失效，正在报名中的活动会被取消报名。继续吗？`)) return;
    if (await run(() => api(`${props.base}/members/${m.id}/deactivate`, {}))) props.onChange();
  }

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
        {error && <p class="error">{error}</p>}
        {props.data.active.length === 0 && <Empty>还没有成员</Empty>}
        {props.data.active.map((m) => (
          <div class="row" key={m.id}>
            {who(m)}
            <div class="actions">
              <button class="button secondary" disabled={busy} onClick={() => view(m)}>
                链接
              </button>
              <button class="button secondary" disabled={busy} onClick={() => regenerate(m)}>
                重新生成
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
        <Card title={`已停用（${props.data.inactive.length}）`}>
          {props.data.inactive.map((m) => (
            <div class="row" key={m.id}>
              {who(m)}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function Settings(props: { base: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [newAdmin, setNewAdmin] = useState("");
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
    await api(`${props.base}/logout`, {}).catch(() => undefined);
    location.reload();
  }

  return (
    <>
      <ThemeCard base={props.base} />
      <FriendCap base={props.base} />
      <TelegramCard base={props.base} />
      <RemindersCard base={props.base} />
      <ExportCard base={props.base} />
      <SheetsCard base={props.base} />
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
      <button class="button secondary block" onClick={logout}>
        退出登录
      </button>
      <AdminGuide base={props.base} />
      <ResetAll base={props.base} />
    </>
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
  const [title, setTitle] = useState(props.initial.siteTitle);
  const [cap, setCap] = useState(String(props.initial.friendCap));
  const [venmo, setVenmo] = useState(props.initial.venmoUsername);
  const [venmoEmail, setVenmoEmail] = useState(props.initial.venmoEmail);
  const [zelle, setZelle] = useState(props.initial.zelleAccount);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const edit = (f: (v: string) => void) => (v: string) => {
    f(v);
    setSaved(false);
  };
  return (
    <Card title="网站与报名设置">
      <Field label="网站标题" value={title} onInput={edit(setTitle)} hint="显示在每个页面顶部和浏览器标签上" />
      <Field label="每人最多带几个朋友" type="number" value={cap} onInput={edit(setCap)} />
      <Field label="你的 Venmo 用户名" value={venmo} onInput={edit(setVenmo)} hint="不用加 @，例如 KeLi8916" />
      <Field
        label="Venmo 通知邮箱"
        type="email"
        value={venmoEmail}
        onInput={edit(setVenmoEmail)}
        hint="Venmo 账户里登记的、接收收款通知的邮箱。只有发到这个邮箱的 Venmo 收款邮件才会自动对账"
      />
      <Field label="你的 Zelle 账号（选填）" value={zelle} onInput={edit(setZelle)} hint="手机号或邮箱，显示在付款页作为备选" />
      {error && <p class="error">{error}</p>}
      <button
        class="button secondary block"
        disabled={busy}
        onClick={async () => {
          const body = { siteTitle: title, friendCap: Number(cap), venmoUsername: venmo, venmoEmail, zelleAccount: zelle };
          if (await run(() => api(`${props.base}/settings`, body))) {
            setSaved(true);
            setSiteTitle(title.trim());
          }
        }}
      >
        {saved ? "已保存" : "保存"}
      </button>
    </Card>
  );
}

/** 外观配色: tapping a swatch previews it at once and saves it for everyone. */
function ThemeCard(props: { base: string }) {
  const [current, setCurrent] = useState(document.documentElement.dataset.theme ?? DEFAULT_THEME);
  const { error, run } = useAction();
  async function choose(id: string) {
    const before = current;
    setCurrent(id);
    applyTheme(id);
    if (!(await run(() => api(`${props.base}/settings`, { theme: id })))) {
      setCurrent(before);
      applyTheme(before);
    }
  }
  return (
    <Card title="外观配色">
      <p class="muted small">所有人看到的网站都会换成这个配色。</p>
      <div class="themes">
        {THEMES.map((t) => (
          <button key={t.id} type="button" class={t.id === current ? "theme on" : "theme"} onClick={() => choose(t.id)}>
            <i style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }} />
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      {error && <p class="error">{error}</p>}
    </Card>
  );
}
