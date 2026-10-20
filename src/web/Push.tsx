import { useEffect, useState } from "preact/hooks";
import { api } from "./api";
import { Card, SettingRow, useAction } from "./components";
import { isIos, standalone } from "./Install";
import { t } from "./i18n";

/**
 * 推送通知: a new event opening for sign-up and their own bill, sent to this browser (sw.js shows
 * them). Each browser is turned on separately; nothing is registered until the member asks.
 */
type PushState = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "other" | "on";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const key = sub.options.applicationServerKey;
  if (!key) return true;
  const a = new Uint8Array(key);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

async function current(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Who turned push on in this browser, and their page: the link page, or /me with Google. sw.js
 * opens the page on a tap. The member id tells one member's page from another's in the same
 * browser (the Owner looking at someone's link, or two people signing in with Google on one
 * computer): only the member who turned it on sees it as on and keeps it in sync.
 */
async function saveOwner(home: string, memberId: string) {
  try {
    const cache = await caches.open("push");
    await cache.put("/push-home", new Response(home));
    await cache.put("/push-member", new Response(memberId));
  } catch {
    /* private mode: notifications open the event page instead */
  }
}

async function savedMember(): Promise<string | null> {
  try {
    return (await (await caches.open("push")).match("/push-member"))?.text() ?? null;
  } catch {
    return null;
  }
}

/** sessionStorage, quietly doing nothing where storage is blocked. */
/**
 * When this browser last checked in, at most hourly (localStorage, as an app on the home screen
 * keeps one session for days); quietly nothing where storage is blocked.
 */
const SYNC_EVERY_MS = 3600_000;
const synced = {
  recently(key: string) {
    try {
      return Date.now() - Number(localStorage.getItem(key) ?? 0) < SYNC_EVERY_MS;
    } catch {
      return false;
    }
  },
  mark(key: string) {
    try {
      localStorage.setItem(key, String(Date.now()));
    } catch {}
  },
};

/**
 * 退出 Google 登录: this browser stops getting the signed-in member's pushes. The browser's own
 * subscription is only dropped when it was theirs (not someone else's link page in this browser).
 */
export async function stopPush() {
  try {
    if (!supported()) return;
    const sub = await current();
    if (!sub) return;
    const { removed } = await api<{ removed: boolean }>("/api/m/session/push/unsubscribe", { endpoint: sub.endpoint });
    if (removed) await sub.unsubscribe();
  } catch {
    /* signing out still goes ahead */
  }
}

/** This browser's state, and turning it on or off for the member whose page this is. */
export function usePush(base: string, home: string, memberId: string) {
  const [state, setState] = useState<PushState>("loading");
  const action = useAction();
  useEffect(() => {
    let alive = true;
    (async (): Promise<PushState> => {
      // iPhone and iPad only offer push to the site added to the home screen and opened from there.
      if (isIos() && !standalone()) return "ios-install";
      if (!supported()) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      const sub = await current();
      if (!sub) return "off";
      // Turned on by another member in this browser (or we can't tell: storage is blocked).
      if ((await savedMember()) !== memberId) return "other";
      // At most hourly: made for the site's current key (a reset makes a new one), the server still
      // has it (a link reset drops it), and a tap opens this page (their current link).
      // (Keyed by the page too: a new link means the old one's subscription was dropped.)
      const key = `push-synced:${memberId}:${home}:${sub.endpoint}`;
      if (!synced.recently(key)) {
        try {
          const { publicKey } = await api<{ publicKey: string }>(`${base}/push`);
          if (!sameKey(sub, publicKey)) {
            await sub.unsubscribe();
            return "off";
          }
          await api(`${base}/push/subscribe`, sub.toJSON());
          await saveOwner(home, memberId);
          synced.mark(key);
        } catch {
          /* offline or a hiccup: try again next visit */
        }
      }
      return "on";
    })()
      .catch((): PushState => "unsupported")
      .then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [base, home, memberId]);

  const enable = () =>
    action.run(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = await api<{ publicKey: string }>(`${base}/push`);
      // One already here (改为推送给我) moves over as it is; one made for another key can't be reused.
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, publicKey)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager
        .subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
        .catch(() => {
          throw new Error(t("这个浏览器没能开启推送，请换个浏览器再试"));
        });
      try {
        await api(`${base}/push/subscribe`, { ...sub.toJSON(), welcome: true });
      } catch (e) {
        // Not on the server: don't leave the browser looking subscribed.
        await sub.unsubscribe().catch(() => {});
        throw e;
      }
      await saveOwner(home, memberId);
      setState("on");
    });

  const disable = () =>
    action.run(async () => {
      const sub = await current();
      if (sub) {
        await api(`${base}/push/unsubscribe`, { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
    });

  return { state, enable, disable, busy: action.busy, error: action.error };
}

/** 个人信息 → 推送通知: a row saying whether it's on here, opening the switch and what it does. */
export function PushRow(props: { base: string; home: string; memberId: string }) {
  const push = usePush(props.base, props.home, props.memberId);
  if (push.state === "loading") return null;
  const value =
    push.state === "on"
      ? t("已开启")
      : push.state === "denied"
        ? t("已拒绝")
        : push.state === "unsupported"
          ? t("不支持")
          : t("未开启");
  return (
    <SettingRow
      icon={<BellIcon />}
      label={t("推送通知")}
      value={value}
      panel={() => (
        <>
          <p>{t("有新活动开始报名、或者你的账单出来时，在这台设备上通知你。")}</p>
          {push.state === "ios-install" && (
            <p class="hint">
              {t(
                "iPhone / iPad 需要先把网站添加到主屏幕（见上面的「添加到主屏幕」），然后从主屏幕的图标打开，再回到这里开启。",
              )}
            </p>
          )}
          {push.state === "unsupported" && (
            <p class="hint">
              {t("这个浏览器不支持推送通知（比如微信里打开的网页）。请用 Chrome、Safari 或 Edge 打开。")}
            </p>
          )}
          {push.state === "denied" && (
            <p class="hint">{t("你之前拒绝了这个网站的通知。请在浏览器的网站设置里允许通知，然后刷新页面。")}</p>
          )}
          {push.state === "other" && (
            <p class="hint">
              {t("这台设备的推送可能是别的成员开启的。改成推送给你以后，对方在这台设备上就收不到了。")}
            </p>
          )}
          {(push.state === "off" || push.state === "other") && (
            <button type="button" class="button block" disabled={push.busy} onClick={push.enable}>
              {push.busy ? t("开启中…") : push.state === "other" ? t("改为推送给我") : t("开启推送")}
            </button>
          )}
          {push.state === "on" && (
            <>
              <p class="muted small">{t("这台设备已开启推送。其他设备需要分别开启。")}</p>
              <button type="button" class="button secondary block" disabled={push.busy} onClick={push.disable}>
                {t("关闭推送")}
              </button>
            </>
          )}
          {push.error && <p class="error">{push.error}</p>}
        </>
      )}
    />
  );
}

const BellIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />
  </svg>
);

const DISMISSED = "push-prompt-dismissed";

/** 我的活动: a one-time offer to turn push on, until they do or say no. */
export function PushPrompt(props: { base: string; home: string; memberId: string }) {
  const push = usePush(props.base, props.home, props.memberId);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed || push.state !== "off" || Notification.permission !== "default") return null;
  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* private mode: just hidden for now */
    }
    setDismissed(true);
  }
  return (
    <Card>
      <p>{t("开启推送，新活动开始报名、账单出来时第一时间知道。")}</p>
      <div class="push-actions">
        <button type="button" class="button" disabled={push.busy} onClick={push.enable}>
          {push.busy ? t("开启中…") : t("开启推送")}
        </button>
        <button type="button" class="button secondary" onClick={dismiss}>
          {t("不用了")}
        </button>
      </div>
      {push.error && <p class="error">{push.error}</p>}
    </Card>
  );
}
