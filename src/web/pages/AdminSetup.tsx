import { useState } from "preact/hooks";
import { api } from "../api";
import { Card, Field, Load, LinkCard, Page, useAction } from "../components";
import { useApi } from "../hooks";

interface SetupResult {
  adminLink: string;
}

/** /admin: first-time setup, or a pointer to the private admin link once set up. */
export function AdminSetup() {
  const [status] = useApi<{ needed: boolean }>("/api/public/admin-setup");
  return (
    <Load result={status}>
      {(s) =>
        s.needed ? (
          <SetupForm />
        ) : (
          <Page title="管理页">
            <GoogleEntry />
            <Card>
              <p>也可以使用你的专属管理链接进入管理页。</p>
              <p class="muted small">
                管理链接丢失时，可在 GitHub Actions
                里手动运行部署并勾选「reset_admin_link」（正式环境选最新的版本标签，测试环境选
                main），然后回到这里用群主密码重新设置。
              </p>
            </Card>
          </Page>
        )
      }
    </Load>
  );
}

/** The admin's Google way in: straight to the admin page when the bound account is signed in. */
function GoogleEntry() {
  const [session] = useApi<{ enabled: boolean; role?: string }>("/api/auth/session");
  if (session.state !== "ok" || !session.data.enabled) return null;
  return (
    <Card>
      {session.data.role === "owner" || session.data.role === "organizer" ? (
        <a class="button block" href="/admin/google">
          进入管理页
        </a>
      ) : (
        <button
          type="button"
          class="button block"
          onClick={() => location.assign("/api/auth/google?next=/admin/google")}
        >
          用 Google 登录管理页
        </button>
      )}
      <p class="muted small">需要先在管理页「设置」里绑定你的 Google 账号。</p>
    </Card>
  );
}

function SetupForm() {
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [result, setResult] = useState<SetupResult | null>(null);
  const { busy, error, run } = useAction();

  if (result) {
    return (
      <Page title="设置完成">
        <LinkCard title="你的管理链接" link={result.adminLink} note="请收藏这个链接，管理页只能从这里进入。" />
        <p class="muted small">你自己报名打球也在管理页里：打开某个活动，在「我的报名」里报名、带朋友。</p>
        <a class="button block" href={new URL(result.adminLink).pathname}>
          进入管理页
        </a>
      </Page>
    );
  }

  async function submit(e: Event) {
    e.preventDefault();
    const r = await run(() =>
      api<SetupResult>("/api/public/admin-setup", { password, username, wechatNickname: nickname }),
    );
    if (r) setResult(r);
  }

  return (
    <Page title="首次设置">
      <Card>
        <form onSubmit={submit}>
          <Field
            label="群主密码"
            type="password"
            value={password}
            onInput={setPassword}
            hint="当前的群主密码（第一次部署时就是 GitHub 里的 ADMIN_PASSWORD；在管理页改过的话用改后的）"
            autocomplete="current-password"
          />
          <Field label="你的用户名" value={username} onInput={setUsername} hint="你作为成员报名时显示的名字" />
          <Field label="你的微信昵称" value={nickname} onInput={setNickname} />
          {error && <p class="error">{error}</p>}
          <button type="submit" class="button block" disabled={busy}>
            {busy ? "设置中…" : "生成管理链接"}
          </button>
        </form>
      </Card>
    </Page>
  );
}
