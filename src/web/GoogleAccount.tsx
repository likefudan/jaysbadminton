import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api } from "./api";
import { useApi } from "./hooks";

/** Shows the avatar received from the verified Google profile, with a fallback. */
export function GoogleAccount() {
  const [session] = useApi<{ signedIn: boolean; email: string | null; picture: string | null }>("/api/auth/session");
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    function outside(e: PointerEvent) {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (session.state !== "ok" || !session.data.signedIn || !session.data.email) return null;
  const email = session.data.email;
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/logout", {});
      sessionStorage.removeItem("google-link-member");
      window.location.assign("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "退出失败，请重试");
      setBusy(false);
    }
  }
  return <div class="google-account" ref={container}>
    <button ref={trigger} class="google-account-trigger" aria-label={`Google 账号：${email}`} title={`已登录 Google：${email}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      {session.data.picture && failedPicture !== session.data.picture ?
        <img class="google-account-avatar" src={session.data.picture} alt="Google 账号头像" referrerPolicy="no-referrer" onError={() => setFailedPicture(session.data.picture)} /> : <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
        <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.6 0-4.8-1.76-5.59-4.13H3.06v2.59A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.31.31-1.92V7.49H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.51l3.35-2.59Z" />
        <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.35 2.59C7.2 7.71 9.4 5.95 12 5.95Z" />
      </svg>}
      <span class="google-account-status" aria-hidden="true" />
    </button>
    {open && <section class="google-account-panel" aria-label="Google 账号信息">
      <p class="google-account-label">已登录 Google</p>
      <p class="google-account-email">{email}</p>
      <a class="button secondary block" href="/me" onClick={() => setOpen(false)}>我的活动</a>
      <button class="button secondary block" disabled={busy} onClick={logout}>{busy ? "正在退出…" : "退出登录"}</button>
      {error && <p class="error" role="alert">{error}</p>}
    </section>}
  </div>;
}
