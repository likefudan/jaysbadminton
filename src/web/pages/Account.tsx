import { useState } from "preact/hooks";
import { api } from "../api";
import { Card, Field, Load, Page, useAction } from "../components";
import { useApi } from "../hooks";
import { Member, MemberProfilePage } from "./Member";

type Session = { enabled: boolean; signedIn: boolean; email: string | null; hasMember: boolean; pending: boolean; emailNotificationsEnabled?: boolean };
const ERRORS: Record<string, string> = {
  not_configured: "网站尚未启用 Google 登录。已有成员可以继续使用原专属链接。",
  invalid_state: "登录请求已过期，请重新登录。",
  cancelled: "你取消了 Google 登录，可以再试一次。",
  failed: "Google 登录未完成，请重试。若持续失败，请联系管理员。",
};

export function Logout() {
  const { busy, error, run } = useAction();
  async function logout() {
    if (await run(() => api("/api/auth/logout", {}))) {
      sessionStorage.removeItem("google-link-member");
      window.location.assign("/login");
    }
  }
  return <><button class="button secondary block" disabled={busy} onClick={logout}>退出 Google 登录</button>{error && <p class="error">{error}</p>}</>;
}

export function GoogleLink(props: { token: string }) {
  const [session, reload] = useApi<Session>("/api/auth/session");
  const { busy, error, run } = useAction();
  async function link() {
    const current = await run(() => api<Session>("/api/auth/session"));
    if (!current) return;
    if (!current.enabled) {
      reload();
      return;
    }
    sessionStorage.setItem("google-link-member", props.token);
    window.location.assign(current.signedIn ? "/me" : "/api/auth/google");
  }
  return <Card title="下次直接用 Google 登录">
    <p>绑定后可直接进入我的活动，原有报名和账单都会保留。</p>
    {session.state === "ok" && !session.data.enabled ? <>
      <p class="hint">网站尚未启用 Google 绑定。你可以继续在这里报名和查看账单；开通后可自行绑定，无需管理员审批。</p>
      <button class="button secondary block" onClick={reload}>重新检查绑定是否可用</button>
    </> : <button class="button secondary block" disabled={busy || session.state !== "ok"} onClick={link}>{busy ? "正在连接…" : "绑定 Google 账号"}</button>}
    {session.state === "error" && <><p class="error" role="alert">{session.message}</p><button class="button secondary block" onClick={reload}>重试</button></>}
    {error && <p class="error" role="alert">{error}</p>}
  </Card>;
}

/** /me/profile: 个人信息 for the Google-signed-in member (the sign-in steps otherwise, as on /me). */
export const AccountProfile = () => <Account page="profile" />;

export function Account(props: { page?: "profile" }) {
  const [session, reload] = useApi<Session>("/api/auth/session");
  return <Load result={session}>{(s) => {
    if (!s.signedIn) return <Page title="登录" subtitle="使用 Google 账号报名，随时查看自己的活动和账单。">
      <Card>
        {ERRORS[new URLSearchParams(window.location.search).get("error") ?? ""] && <p class="error" role="alert">{ERRORS[new URLSearchParams(window.location.search).get("error") ?? ""]}</p>}
        {s.enabled ? <button class="button block" onClick={() => window.location.assign("/api/auth/google")}>使用 Google 登录</button> : <p class="hint">网站尚未启用 Google 登录。已有成员可以继续使用原专属链接。</p>}
        <p class="muted small">仅使用 Google 账号身份、邮箱和头像，不读取你的 Gmail 邮件。</p>
      </Card>
    </Page>;
    if (s.pending) return <Page title="申请已提交" subtitle={`Google 账号：${s.email}`}>
      <Card>
        <p>管理员审核通过后，用这个 Google 账号登录就能报名活动、查看账单。</p>
        <p class="muted small">审核前还不能报名。你可以刷新查看审核状态。</p>
        {s.emailNotificationsEnabled && <p class="muted small">审核通过后会向你的 Google 邮箱发送通知，请留意收件箱和垃圾邮件。</p>}
        <button class="button secondary block" onClick={reload}>刷新审核状态</button>
      </Card>
      <Logout />
    </Page>;
    if (s.hasMember && !sessionStorage.getItem("google-link-member")) return props.page === "profile" ? <MemberProfilePage /> : <Member />;
    return <Profile email={s.email!} onDone={reload} />;
  }}</Load>;
}

function Profile(props: { email: string; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [wechatAccount, setWechatAccount] = useState("");
  const [oldLink, setOldLink] = useState(sessionStorage.getItem("google-link-member") ?? "");
  const [linkExisting, setLinkExisting] = useState(!!oldLink);
  const { busy, error, run } = useAction();
  async function submit(e: Event) {
    e.preventDefault();
    const result = await run(async () => {
      if (linkExisting) {
        let token = oldLink.trim();
        if (token.includes("://")) {
          const match = new URL(token).pathname.match(/^\/m\/([^/]+)\/?$/);
          if (!match) throw new Error("请填写原来的成员专属链接");
          token = match[1]!;
        }
        return api("/api/auth/link", { token });
      }
      return api("/api/auth/register", { username, applicantName, wechatAccount });
    });
    if (result) {
      sessionStorage.removeItem("google-link-member");
      props.onDone();
    }
  }
  return <Page title={linkExisting ? "关联原有成员" : "申请加入"} subtitle={`已登录：${props.email}`}>
    <Card>
      <form onSubmit={submit}>
        {linkExisting ? <>
          <p>确认将此 Google 账号绑定到原成员。历史报名和账单会继续保留。</p>
          <Field label="原成员专属链接" value={oldLink} onInput={setOldLink} hint="填写你原来使用的 /m/ 开头的成员页面链接。" />
        </> : <>
          <Field label="你是谁" value={applicantName} onInput={setApplicantName} hint="填写姓名或群友能认出你的称呼，供管理员审核" />
          <Field label="微信账号" value={wechatAccount} onInput={setWechatAccount} hint="填写微信号或微信昵称，方便管理员核实身份" />
          <Field label="群内用户名" value={username} onInput={setUsername} hint="显示在群内和报名名单上，不可重复" />
          <p class="muted small">提交后需要管理员审核，通过后才能报名活动。</p>
        </>}
        {error && <p class="error" role="alert">{error}</p>}
        <button class="button block" disabled={busy}>{busy ? "保存中…" : linkExisting ? "确认绑定，进入我的活动" : "提交入群申请"}</button>
        <button class="button secondary block" type="button" disabled={busy} onClick={() => setLinkExisting(!linkExisting)}>{linkExisting ? "我是新成员，创建账号" : "已有成员链接？关联原账号"}</button>
      </form>
    </Card>
    <Logout />
  </Page>;
}
