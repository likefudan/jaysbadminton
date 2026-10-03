import { useState } from "preact/hooks";
import { checkMessage, checkNickname, checkUsername } from "../../shared/rules";
import { api } from "../api";
import { ApplicationFields } from "../ApplicationFields";
import { Card, Field, Load, Page, useAction } from "../components";
import { useApi } from "../hooks";
import { Member, MemberProfilePage } from "./Member";

type Session = {
  enabled: boolean;
  signedIn: boolean;
  email: string | null;
  hasMember: boolean;
  pending: boolean;
  emailNotificationsEnabled?: boolean;
};
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
  return (
    <>
      <button type="button" class="button secondary block" disabled={busy} onClick={logout}>
        退出 Google 登录
      </button>
      {error && <p class="error">{error}</p>}
    </>
  );
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
  return (
    <Card title="下次直接用 Google 登录">
      <p>绑定后可直接进入我的活动，原有报名和账单都会保留。</p>
      {session.state === "ok" && !session.data.enabled ? (
        <>
          <p class="hint">
            网站尚未启用 Google 绑定。你可以继续在这里报名和查看账单；开通后可自行绑定，无需管理员审批。
          </p>
          <button type="button" class="button secondary block" onClick={reload}>
            重新检查绑定是否可用
          </button>
        </>
      ) : (
        <button type="button" class="button secondary block" disabled={busy || session.state !== "ok"} onClick={link}>
          {busy ? "正在连接…" : "绑定 Google 账号"}
        </button>
      )}
      {session.state === "error" && (
        <>
          <p class="error" role="alert">
            {session.message}
          </p>
          <button type="button" class="button secondary block" onClick={reload}>
            重试
          </button>
        </>
      )}
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

/** /me/profile: 个人信息 for the Google-signed-in member (the sign-in steps otherwise, as on /me). */
export const AccountProfile = () => <Account page="profile" />;

const inWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

/** 登录 / 注册: the one way in for everyone — Google, or email (the link comes by email). */
function SignIn(props: { googleEnabled: boolean }) {
  const error = ERRORS[new URLSearchParams(window.location.search).get("error") ?? ""];
  return (
    <Page title="登录 / 注册" subtitle="已经是成员就登录；新朋友在这里申请入群，管理员审核后就能报名。">
      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}
      {props.googleEnabled && (
        <Card title="用 Google 账号">
          <p>第一次用 Google 登录时填写申请，审核通过后用同一个账号登录即可。</p>
          {inWeChat() && (
            <p class="hint">
              微信里可能无法使用 Google 登录：请点右上角「···」选择「在浏览器打开」，或者用下面的邮箱注册。
            </p>
          )}
          <button type="button" class="button block" onClick={() => window.location.assign("/api/auth/google")}>
            用 Google 登录 / 注册
          </button>
          <p class="muted small">仅使用 Google 账号身份、邮箱和头像，不读取你的 Gmail 邮件。</p>
        </Card>
      )}
      <Card title="用邮箱注册">
        <p>审核通过后，专属链接会发到你的邮箱，以后用这个链接登录（在微信里也能直接打开）。</p>
        <a class="button block" href="/join">
          用邮箱注册
        </a>
      </Card>
      <p class="center">
        <a href="/recover">已经是成员？找回我的专属链接</a>
      </p>
    </Page>
  );
}

export function Account(props: { page?: "profile" }) {
  const [session, reload] = useApi<Session>("/api/auth/session");
  return (
    <Load result={session}>
      {(s) => {
        if (!s.signedIn) return <SignIn googleEnabled={s.enabled} />;
        if (s.pending)
          return (
            <Page title="申请已提交" subtitle={`Google 账号：${s.email}`}>
              <Card>
                <p>管理员审核通过后，用这个 Google 账号登录就能报名活动、查看账单。</p>
                <p class="muted small">审核前还不能报名。你可以刷新查看审核状态。</p>
                {s.emailNotificationsEnabled && (
                  <p class="muted small">审核通过后会向你的 Google 邮箱发送通知，请留意收件箱和垃圾邮件。</p>
                )}
                <button type="button" class="button secondary block" onClick={reload}>
                  刷新审核状态
                </button>
              </Card>
              <Logout />
            </Page>
          );
        if (s.hasMember && !sessionStorage.getItem("google-link-member"))
          return props.page === "profile" ? <MemberProfilePage /> : <Member />;
        return <Profile email={s.email!} onDone={reload} />;
      }}
    </Load>
  );
}

function Profile(props: { email: string; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
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
      const err = checkUsername(username) ?? checkNickname(nickname) ?? checkMessage(message);
      if (err) throw new Error(err);
      return api("/api/auth/register", { username, wechatNickname: nickname, message });
    });
    if (result) {
      sessionStorage.removeItem("google-link-member");
      props.onDone();
    }
  }
  return (
    <Page title={linkExisting ? "关联原有成员" : "申请加入"} subtitle={`已登录：${props.email}`}>
      <Card>
        <form onSubmit={submit}>
          {linkExisting ? (
            <>
              <p>确认将此 Google 账号绑定到原成员。历史报名和账单会继续保留。</p>
              <Field
                label="原成员专属链接"
                value={oldLink}
                onInput={setOldLink}
                hint="填写你原来使用的 /m/ 开头的成员页面链接。"
              />
            </>
          ) : (
            <>
              <ApplicationFields
                username={username}
                setUsername={setUsername}
                nickname={nickname}
                setNickname={setNickname}
                message={message}
                setMessage={setMessage}
              />
              <p class="muted small">提交后需要管理员审核，通过后才能报名活动。</p>
            </>
          )}
          {error && (
            <p class="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" class="button block" disabled={busy}>
            {busy ? "保存中…" : linkExisting ? "确认绑定，进入我的活动" : "提交入群申请"}
          </button>
          <button
            class="button secondary block"
            type="button"
            disabled={busy}
            onClick={() => setLinkExisting(!linkExisting)}
          >
            {linkExisting ? "我是新成员，创建账号" : "已有成员链接？关联原账号"}
          </button>
        </form>
      </Card>
      <Logout />
    </Page>
  );
}
