import { Panel } from "./Panel";
import { useState } from "preact/hooks";
import { t, tx } from "./i18n";
import { CheckIcon, isIos, MoreIcon, ShareIcon } from "./Install";

/**
 * WeChat's own browser can't sign in with Google, and people often open the site from a WeChat
 * group. So when signed out inside WeChat (Ke Li, option A + C): a strip under the top bar says
 * to open the page in Safari (iPhone) or the browser (Android), and 登录 / 注册 opens the steps
 * as a sheet instead of a sign-in that would fail.
 */
export const inWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

const DISMISSED = "wechat-hint-dismissed";

const CompassIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
  </svg>
);

/** 「⋯」 drawn like WeChat's own button, inside a sentence. */
const MoreChip = () => (
  <span class="wechat-more" role="img" aria-label="⋯">
    <MoreIcon />
  </span>
);

const openStep = () => (isIos() ? t("选「在 Safari 中打开」") : t("选「在浏览器打开」"));

/** The strip under the top bar. ✕ hides it until WeChat opens the page again (登录 / 注册 still shows the steps). */
export function WeChatBanner() {
  const [shown, setShown] = useState(() => {
    if (!inWeChat()) return false;
    try {
      return sessionStorage.getItem(DISMISSED) !== "1";
    } catch {
      return true;
    }
  });
  if (!shown) return null;
  const close = () => {
    setShown(false);
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {
      /* private mode: just for now */
    }
  };
  return (
    <div class="wechat-banner" role="note">
      <div>
        <strong>{t("微信里不能用 Google 登录")}</strong>
        <br />
        {isIos()
          ? tx("点右上角 {more}，选「在 Safari 中打开」", { more: <MoreChip /> })
          : tx("点右上角 {more}，选「在浏览器打开」", { more: <MoreChip /> })}
      </div>
      <button type="button" class="wechat-banner-close" aria-label={t("关闭")} onClick={close}>
        ✕
      </button>
    </div>
  );
}

/** The steps out of WeChat, as a sheet over the page (like 添加到主屏幕). */
export function WeChatSheet(props: { onClose: () => void }) {
  const ios = isIos();
  const title = ios ? t("用 Safari 登录") : t("用浏览器登录");
  return (
    <Panel title={title} label={title} onClose={props.onClose}>
      <p class="sheet-lead">
        {ios ? t("微信里不能用 Google 登录，请换到 Safari：") : t("微信里不能用 Google 登录，请换到浏览器：")}
      </p>
      <ol class="install-steps">
        <li>
          <MoreIcon />
          <span>{t("点微信右上角的「⋯」")}</span>
        </li>
        <li>
          {ios ? <CompassIcon /> : <ShareIcon />}
          <span>{openStep()}</span>
        </li>
        <li>
          <CheckIcon />
          <span>{ios ? t("在 Safari 里点「登录 / 注册」") : t("在浏览器里点「登录 / 注册」")}</span>
        </li>
      </ol>
    </Panel>
  );
}
