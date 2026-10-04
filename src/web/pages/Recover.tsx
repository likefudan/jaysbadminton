import { useState } from "preact/hooks";
import { checkEmail } from "../../shared/rules";
import { api } from "../api";
import { Card, Field, Page, useAction } from "../components";

/** 找回我的专属链接: the link is emailed again to the address the member registered with. */
export function Recover() {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [sent, setSent] = useState("");
  const { busy, error, run, setError } = useAction();

  async function submit(e: Event) {
    e.preventDefault();
    const err = checkEmail(email);
    if (err) return setError(err);
    if (await run(() => api("/api/public/recover-link", { email, website }))) setSent(email.trim());
  }

  return (
    <Page title="找回我的专属链接" subtitle="填写你注册时（或在个人信息里）留的邮箱。">
      <Card>
        {sent ? (
          <>
            <p role="status">
              如果 <strong>{sent}</strong>{" "}
              是已通过审核的成员邮箱，专属链接已经发过去了，请查看邮箱（也看一下垃圾邮件）。
            </p>
            <p class="muted small">
              同一个邮箱每小时最多发一次。用 Google 登录的成员会收到登录方法。还是收不到的话，请联系群主。
            </p>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <Field label="邮箱" type="email" value={email} onInput={setEmail} autocomplete="email" />
            <input
              class="hp"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onInput={(e) => setWebsite((e.target as HTMLInputElement).value)}
              aria-hidden="true"
            />
            {error && <p class="error">{error}</p>}
            <button type="submit" class="button block" disabled={busy}>
              {busy ? "发送中…" : "发送专属链接"}
            </button>
          </form>
        )}
      </Card>
      <a class="button secondary block" href="/login">
        返回
      </a>
    </Page>
  );
}
