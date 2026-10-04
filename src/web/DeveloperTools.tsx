import { useState } from "preact/hooks";
import { api } from "./api";
import { Card, Field, useAction } from "./components";
import { useApi } from "./hooks";

export function DeveloperLogin() {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  async function login(e: Event) {
    e.preventDefault();
    if (await run(() => api("/api/developer/login", { password }))) {
      sessionStorage.removeItem("google-link-member");
      location.assign("/me");
    }
  }
  return <Card title="开发者登录">
    <p>用测试环境的管理员密码登录，快速切换管理员和普通测试成员界面。</p>
    <form onSubmit={login}>
      <Field label="开发者密码" type="password" value={password} onInput={setPassword} autocomplete="current-password" />
      {error && <p class="error" role="alert">{error}</p>}
      <button class="button block" disabled={busy}>{busy ? "登录中…" : "开发者登录"}</button>
    </form>
  </Card>;
}

export function DeveloperSwitch() {
  const [session] = useApi<{ signedIn: boolean }>("/api/developer/session");
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();
  if (session.state !== "ok" || !session.data.signedIn) return null;
  async function logout() {
    if (await run(() => api("/api/developer/logout", {}))) location.assign("/login");
  }
  const admin = location.pathname.startsWith("/admin/");
  return <aside class="developer-tools" aria-label="开发者工具">
    {open && <section class="developer-tools-panel" aria-label="切换测试界面">
      <p class="small">当前：{admin ? "管理员界面" : "普通用户界面"}</p>
      <a class="button secondary block" href="/admin/developer">管理员界面</a>
      <a class="button secondary block" href="/me">普通用户界面</a>
      <button class="button secondary block" disabled={busy} onClick={logout}>退出开发者登录</button>
      {error && <p class="error" role="alert">{error}</p>}
    </section>}
    <button class="button developer-switch" aria-expanded={open} onClick={() => setOpen(!open)}>开发者 · 切换界面</button>
  </aside>;
}
