import { useEffect, useState } from "preact/hooks";
import { api } from "./api";
import { SectionTitle, SettingRow, useAction } from "./components";
import { t } from "./i18n";
import { MyBoardsCard } from "./MyBoards";
import { forgetOfflineData } from "./offline";
import { Panel } from "./Panel";

/**
 * 设置 › 隐私 (Ke Li 2026-11-21): a page of its own for what decides what others see of them and
 * what the site keeps: 参加的排行榜, then 隐私政策 and 删除账号. Privacy switches added later go here.
 * 「我的上榜设置 ›」 under the boards opens it straight away (startOpen).
 */
export function PrivacyRow(props: { base: string; active: boolean; startOpen?: boolean; onChange?: () => void }) {
  const [open, setOpen] = useState(false);
  // Opened after 设置 has mounted, so its panel goes on top of 设置's rather than under it.
  useEffect(() => {
    if (props.startOpen) setOpen(true);
  }, []);
  return (
    <>
      <SettingRow
        icon={<LockIcon />}
        label={t("隐私")}
        sub={props.active ? t("排行榜、隐私政策、删除账号") : t("隐私政策、删除账号")}
        onClick={() => setOpen(true)}
      />
      {open && (
        <Panel title={t("隐私")} label={t("隐私")} onClose={() => setOpen(false)}>
          {props.active && (
            <>
              <SectionTitle>{t("参加的排行榜")}</SectionTitle>
              <MyBoardsCard base={props.base} onChange={props.onChange} />
            </>
          )}
          <SectionTitle>{t("其他")}</SectionTitle>
          <section class="card set-list">
            <SettingRow icon={<DocIcon />} label={t("隐私政策")} href="/privacy" />
            <SettingRow
              icon={<TrashIcon />}
              label={t("删除账号")}
              panel={(close) => <DeleteAccountForm base={props.base} close={close} />}
            />
          </section>
        </Panel>
      )}
    </>
  );
}

/** 删除账号: told what goes, then asked once more before anything happens. */
function DeleteAccountForm(props: { base: string; close: () => void }) {
  const { busy, error, run } = useAction();
  async function remove() {
    if (!confirm(t("确定删除账号？删除后不能恢复。"))) return;
    if (!(await run(() => api(`${props.base}/account/delete`, { confirm: true })))) return;
    try {
      await api("/api/auth/logout", {});
    } catch {
      /* the account is gone either way */
    }
    await forgetOfflineData();
    window.location.assign("/");
  }
  return (
    <div>
      <p class="muted small">
        {t(
          "删除后，你的登录、名字、头像、邮箱、微信名、卡路里、点赞和自付费用记录都会删掉，不能恢复。以前活动的名单和账单会留着，但只显示为「已删除成员」。以后想回来，要重新申请加入。",
        )}
      </p>
      {error && <p class="error">{error}</p>}
      <div class="inline">
        <button type="button" class="button danger" disabled={busy} onClick={remove}>
          {t("删除账号")}
        </button>
        <button class="button secondary" type="button" onClick={props.close}>
          {t("取消")}
        </button>
      </div>
    </div>
  );
}

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
const DocIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />
  </svg>
);
