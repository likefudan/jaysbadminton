import { useState } from "preact/hooks";
import { api } from "../api";
import { Card, Field, Load, Page, useAction } from "../components";
import { useApi } from "../hooks";
import { Member } from "./Member";

type Session = { enabled: boolean; signedIn: boolean; email: string | null; hasMember: boolean; unavailable: boolean };
const ERRORS: Record<string, string> = {
  not_configured: "Google 登录暂未开通，请联系管理员。",
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
  return <Card title="下次直接用 Google 登录">
    <p>绑定后可直接进入我的活动，原有报名和账单都会保留。</p>
    <a class="button secondary block" href="/login" onClick={() => sessionStorage.setItem("google-link-member", props.token)}>绑定 Google 账号</a>
  </Card>;
}

export function Account() {
  const [session, reload] = useApi<Session>("/api/auth/session");
  return <Load result={session}>{(s) => {
    if (!s.signedIn) return <Page title="登录" subtitle="使用 Google 账号报名，随时查看自己的活动和账单。">
      <Card>
        {ERRORS[new URLSearchParams(window.location.search).get("error") ?? ""] && <p class="error" role="alert">{ERRORS[new URLSearchParams(window.location.search).get("error") ?? ""]}</p>}
        {s.enabled ? <button class="button block" onClick={() => window.location.assign("/api/auth/google")}>使用 Google 登录</button> : <p class="hint">Google 登录暂未开通，请联系管理员完成配置。</p>}
        <p class="muted small">仅使用 Google 账号身份和邮箱，不读取你的 Gmail 邮件。</p>
      </Card>
    </Page>;
    if (s.unavailable) return <Page title="账号暂不可用"><Card><p>此账号对应的成员已删除或尚未获准使用，请联系管理员。</p><Logout /></Card></Page>;
    if (s.hasMember) return <Member />;
    return <Profile email={s.email!} onDone={reload} />;
  }}</Load>;
}

function Profile(props: { email: string; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
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
      return api("/api/auth/register", { username, wechatNickname: nickname });
    });
    if (result) {
      sessionStorage.removeItem("google-link-member");
      props.onDone();
    }
  }
  return <Page title={linkExisting ? "关联原有成员" : "完善成员资料"} subtitle={`已登录：${props.email}`}>
    <Card>
      <form onSubmit={submit}>
        {linkExisting ? <>
          <p>确认将此 Google 账号绑定到原成员。历史报名和账单会继续保留。</p>
          <Field label="原成员专属链接" value={oldLink} onInput={setOldLink} hint="填写你原来使用的 /m/ 开头的成员页面链接。" />
        </> : <>
          <Field label="用户名" value={username} onInput={setUsername} hint="显示在报名名单上，不可重复" />
          <Field label="微信昵称" value={nickname} onInput={setNickname} hint="方便群友认出你" />
        </>}
        {error && <p class="error" role="alert">{error}</p>}
        <button class="button block" disabled={busy}>{busy ? "保存中…" : linkExisting ? "确认绑定，进入我的活动" : "完成注册，开始报名"}</button>
        <button class="button secondary block" type="button" disabled={busy} onClick={() => setLinkExisting(!linkExisting)}>{linkExisting ? "我是新成员，创建账号" : "已有成员链接？关联原账号"}</button>
      </form>
    </Card>
    <Logout />
  </Page>;
}
