import { useState } from "preact/hooks";
import { checkMessage, checkNickname, checkUsername } from "../../shared/rules";
import { api } from "../api";
import { ApplicationFields } from "../ApplicationFields";
import { Card, Page, useAction } from "../components";

export function Join() {
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run, setError } = useAction();

  async function submit(e: Event) {
    e.preventDefault();
    const err = checkUsername(username) ?? checkNickname(nickname) ?? checkMessage(message);
    if (err) return setError(err);
    const ok = await run(() => api("/api/public/join", { username, wechatNickname: nickname, message, website }));
    if (ok) setDone(true);
  }

  if (done) {
    return (
      <Page title="申请已提交">
        <Card>
          <p>管理员通过后，会在微信上私信你的专属链接。之后报名、查看费用都用这个链接。</p>
        </Card>
        <a class="button secondary block" href="/">
          回到首页
        </a>
      </Page>
    );
  }

  return (
    <Page title="申请加入">
      <Card title="使用 Google 账号加入">
        <p>登录后填写申请，管理员通过后用 Google 登录就能报名，不用等管理员发链接。</p>
        <a class="button block" href="/login">使用 Google 登录</a>
      </Card>
      <Card>
        <p class="muted small">也可以使用原有方式提交申请，由管理员审核后发送成员链接。</p>
        <form onSubmit={submit}>
          <ApplicationFields username={username} setUsername={setUsername} nickname={nickname} setNickname={setNickname} message={message} setMessage={setMessage} />
          <input class="hp" tabIndex={-1} autoComplete="off" value={website} onInput={(e) => setWebsite((e.target as HTMLInputElement).value)} aria-hidden="true" />
          {error && <p class="error">{error}</p>}
          <button class="button block" disabled={busy}>
            {busy ? "提交中…" : "提交申请"}
          </button>
        </form>
      </Card>
    </Page>
  );
}
