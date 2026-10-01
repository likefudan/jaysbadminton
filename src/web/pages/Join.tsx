import { useState } from "preact/hooks";
import { checkNickname, checkUsername } from "../../shared/rules";
import { api } from "../api";
import { Card, Field, Page, useAction } from "../components";

export function Join() {
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [website, setWebsite] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run, setError } = useAction();

  async function submit(e: Event) {
    e.preventDefault();
    const err = checkUsername(username) ?? checkNickname(nickname);
    if (err) return setError(err);
    const ok = await run(() => api("/api/public/join", { username, wechatNickname: nickname, website }));
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
      <Card>
        <form onSubmit={submit}>
          <Field label="用户名" value={username} onInput={setUsername} hint="会显示在报名名单上，不能和别人重复" autocomplete="nickname" />
          <Field label="微信昵称" value={nickname} onInput={setNickname} hint="方便管理员在群里找到你" />
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
