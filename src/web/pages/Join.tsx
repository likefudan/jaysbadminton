import { useState } from "preact/hooks";
import { checkEmail, checkMessage, checkNickname, checkUsername } from "../../shared/rules";
import { api } from "../api";
import { ApplicationFields } from "../ApplicationFields";
import { Card, Field, Page, useAction } from "../components";
import { t, tx } from "../i18n";
import { useTurnstile } from "../Turnstile";
import { useAutoJoin } from "../site";
import type { ApprovalEmailStatus } from "../../shared/types";

/** 用邮箱注册: the same application as with Google, plus an email (typed twice) for the link. */
export function Join() {
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [website, setWebsite] = useState("");
  // What the server said: approved when 入群不需要审核 let them straight in.
  const [done, setDone] = useState<{ approved?: boolean; emailStatus?: ApprovalEmailStatus } | null>(null);
  const autoJoin = useAutoJoin();
  const { busy, error, run, setError } = useAction();
  const turnstile = useTurnstile("join");

  async function submit(e: Event) {
    e.preventDefault();
    const err =
      checkUsername(username) ??
      checkNickname(nickname) ??
      checkEmail(email) ??
      (email.trim().toLowerCase() !== emailConfirm.trim().toLowerCase() ? t("两次输入的邮箱不一致") : null) ??
      checkMessage(message) ??
      turnstile.check();
    if (err) return setError(err);
    const ok = await run(() =>
      api<{ approved?: boolean; emailStatus?: ApprovalEmailStatus }>("/api/public/join", {
        username,
        wechatNickname: nickname,
        email,
        emailConfirm,
        message,
        website,
        ...turnstile.field,
      }),
    );
    if (ok) setDone(ok);
    else turnstile.reset();
  }

  if (done?.approved) {
    const sent = done.emailStatus === "sent";
    return (
      <Page title={t("你已入群")}>
        <Card>
          <p>
            {sent
              ? tx("你的专属链接已经发到 {email}。以后报名、查看账单都用这个链接。", {
                  email: <strong>{email.trim()}</strong>,
                })
              : t("邮件暂时没有发出去。请稍后在「登录 / 注册」页点「找回我的专属链接」，或者联系群主。")}
          </p>
          {sent && (
            <p class="muted small">
              {t("没收到的话，请看一下垃圾邮件文件夹；也可以在「登录 / 注册」页点「找回我的专属链接」。")}
            </p>
          )}
        </Card>
        <a class="button secondary block" href="/">
          {t("回到首页")}
        </a>
      </Page>
    );
  }

  if (done) {
    return (
      <Page title={t("申请已提交")}>
        <Card>
          <p>
            {tx("审核通过后，你的专属链接会发到 {email}。以后报名、查看账单都用这个链接。", {
              email: <strong>{email.trim()}</strong>,
            })}
          </p>
          <p class="muted small">
            {t("没收到的话，请看一下垃圾邮件文件夹；也可以在「登录 / 注册」页点「找回我的专属链接」。")}
          </p>
        </Card>
        <a class="button secondary block" href="/">
          {t("回到首页")}
        </a>
      </Page>
    );
  }

  return (
    <Page
      title={t("用邮箱注册")}
      subtitle={autoJoin ? t("提交后，专属链接会发到你的邮箱。") : t("审核通过后，专属链接会发到你的邮箱。")}
    >
      <Card>
        <form onSubmit={submit} noValidate>
          <ApplicationFields
            username={username}
            setUsername={setUsername}
            nickname={nickname}
            setNickname={setNickname}
            message={message}
            setMessage={setMessage}
          />
          <Field
            label={t("邮箱")}
            type="email"
            value={email}
            onInput={setEmail}
            autocomplete="email"
            hint={t("专属链接会发到这个邮箱")}
          />
          <Field
            label={t("再输一次邮箱")}
            type="email"
            value={emailConfirm}
            onInput={setEmailConfirm}
            autocomplete="off"
          />
          <input
            class="hp"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onInput={(e) => setWebsite((e.target as HTMLInputElement).value)}
            aria-hidden="true"
          />
          {turnstile.widget}
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button block" disabled={busy}>
            {busy ? t("提交中…") : t("提交申请")}
          </button>
        </form>
      </Card>
      <a class="button secondary block" href="/login">
        {t("返回")}
      </a>
    </Page>
  );
}
