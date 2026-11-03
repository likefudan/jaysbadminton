import { useEffect, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { Card, SettingRow } from "./components";
import { t } from "./i18n";

/**
 * 添加到主屏幕: the site as an app on the phone's home screen, opening straight onto the member's
 * own page. Chrome, Edge and Samsung Internet install it with one tap (beforeinstallprompt);
 * iPhone and iPad have no such call, so there the button opens a short guide to Safari's
 * 分享 → 添加到主屏幕. WeChat can't add anything, so it says to open the page in a browser.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const ua = () => navigator.userAgent;
export const isIos = () =>
  /iPhone|iPad|iPod/.test(ua()) || (ua().includes("Macintosh") && navigator.maxTouchPoints > 1);
export const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || !!(navigator as { standalone?: boolean }).standalone;
const isWechat = () => /MicroMessenger/i.test(ua());

const INSTALLED = "app-installed";
const DISMISSED = "install-prompt-dismissed";
const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  },
  set(key: string) {
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* private mode: just for now */
    }
  },
};

// Chrome fires this once, early, often before the member's page has loaded its data: kept here
// for whenever the button is tapped. Calling preventDefault keeps Chrome's own small bar away.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const f of listeners) f();
};
if (typeof window !== "undefined") {
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  addEventListener("appinstalled", () => {
    deferred = null;
    store.set(INSTALLED);
    changed();
  });
}

/**
 * How this browser adds the site: "prompt" (one tap), "ios" (the guide), "wechat" (open in a
 * browser first), or "none" (already the app, already installed, or a browser we can't help).
 */
type InstallKind = "prompt" | "ios" | "wechat" | "none";

function kind(): InstallKind {
  if (standalone()) return "none";
  if (isWechat()) return "wechat";
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  return "none";
}

export function useInstall() {
  const [k, setK] = useState<InstallKind>(kind);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const update = () => setK(kind());
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  async function add() {
    if (k === "prompt" && deferred) {
      const e = deferred;
      deferred = null;
      await e.prompt();
      if ((await e.userChoice).outcome === "accepted") store.set(INSTALLED);
      changed();
    } else {
      setGuide(true);
    }
  }
  return { kind: k, add, guide, closeGuide: () => setGuide(false) };
}

/** Where ?add=1 sends them: 个人信息 adds the site from 我的活动, so the icon opens there. */
const ADD_PARAM = "add";

/**
 * 我的活动: a prominent offer at the top, until they add it or say 不用了. Opens the guide when
 * 个人信息 sent them here with ?add=1 (the query is dropped at once, so it isn't what's added).
 */
export function InstallPrompt(props: { onShown?: (shown: boolean) => void }) {
  const install = useInstall();
  const [dismissed, setDismissed] = useState(() => store.get(DISMISSED));
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get(ADD_PARAM) !== "1") return;
    url.searchParams.delete(ADD_PARAM);
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    if (kind() === "ios") install.add();
  }, []);
  const shown = !dismissed && install.kind !== "none";
  useEffect(() => props.onShown?.(shown), [shown]);
  function dismiss() {
    store.set(DISMISSED);
    setDismissed(true);
  }
  return (
    <>
      {shown && (
        <Card class="install-offer">
          <div class="install-head">
            <img src="/icon-192.png" alt="" width={48} height={48} />
            <div>
              <strong>{t("把羽毛球添加到主屏幕")}</strong>
              <p class="muted small">{blurb(install.kind)}</p>
            </div>
          </div>
          <div class="push-actions">
            <button type="button" class="button" onClick={install.add}>
              {install.kind === "wechat" ? t("怎么打开") : t("添加到主屏幕")}
            </button>
            <button type="button" class="button secondary" onClick={dismiss}>
              {t("不用了")}
            </button>
          </div>
        </Card>
      )}
      {install.guide && <InstallGuide kind={install.kind} onClose={install.closeGuide} />}
    </>
  );
}

function blurb(k: InstallKind) {
  if (k === "wechat") return t("微信里不能添加。用浏览器打开这一页，就可以添加到主屏幕了。");
  if (k === "ios") return t("像 App 一样一点就打开你的页面。iPhone 添加以后才能收到推送通知。");
  return t("像 App 一样一点就打开你的页面，不用再找链接。");
}

/**
 * 个人信息 → 添加到主屏幕, kept here for good (also after 不用了 on 我的活动). iPhone goes back to
 * 我的活动 to add it (Safari adds the page it's on, and the icon should open there); Chrome's
 * one-tap prompt can only run on the tap itself, so it stays here.
 */
export function InstallRow(props: { home: string }) {
  const install = useInstall();
  if (install.kind === "none") return null;
  return (
    <>
      <SettingRow
        icon={<AddIcon />}
        label={t("添加到主屏幕")}
        href={install.kind === "ios" ? `${props.home}?${ADD_PARAM}=1` : undefined}
        onClick={install.kind === "ios" ? undefined : install.add}
      />
      {install.guide && <InstallGuide kind={install.kind} onClose={install.closeGuide} />}
    </>
  );
}

export const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);
const AddIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.8" />
    <path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </svg>
);
export const MoreIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
  </svg>
);

export const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path
      d="M5 12.5l4.5 4.5L19 7.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

/** The steps (iPhone, or getting out of WeChat), as a sheet over the page (like 分享名片). */
function InstallGuide(props: { kind: InstallKind; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const wechat = props.kind === "wechat";
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside is a mouse shortcut; Esc and ✕ close it too
    // biome-ignore lint/a11y/useKeyWithClickEvents: same as above
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-label={wechat ? t("用浏览器打开") : t("添加到主屏幕")}>
        <div class="sheet-head">
          <strong>{wechat ? t("用浏览器打开") : t("添加到主屏幕")}</strong>
          <button type="button" class="sheet-close" aria-label={t("关闭")} onClick={props.onClose}>
            ✕
          </button>
        </div>
        {wechat ? (
          <ol class="install-steps">
            <li>
              <MoreIcon />
              <span>{t("点微信右上角的「⋯」")}</span>
            </li>
            <li>
              <ShareIcon />
              <span>{isIos() ? t("选「在 Safari 中打开」") : t("选「在浏览器打开」")}</span>
            </li>
            <li>
              <AddIcon />
              <span>{t("在浏览器里回到这一页，点「添加到主屏幕」")}</span>
            </li>
          </ol>
        ) : (
          <ol class="install-steps">
            <li>
              <ShareIcon />
              <span>{t("点 Safari 的「分享」按钮（新版 Safari 先点右下角的「⋯」）")}</span>
            </li>
            <li>
              <AddIcon />
              <span>{t("往下滑，选「添加到主屏幕」")}</span>
            </li>
            <li>
              <CheckIcon />
              <span>{t("打开「作为 Web App 打开」（如果有这个开关），点右上角的「添加」")}</span>
            </li>
          </ol>
        )}
        {!wechat && (
          <p class="muted small sheet-note">{t("添加以后，从主屏幕的「羽毛球」图标打开，就直接到你的页面。")}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
