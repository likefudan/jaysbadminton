import { Page } from "../components";
import { t } from "../i18n";

export function NotFound() {
  return (
    <Page title={t("页面不存在")}>
      <p>{t("链接可能有误或已失效，请联系群主。")}</p>
      <a class="button block" href="/">
        {t("回到首页")}
      </a>
    </Page>
  );
}
