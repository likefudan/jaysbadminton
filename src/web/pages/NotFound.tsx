import { Page } from "../components";

export function NotFound() {
  return (
    <Page title="页面不存在">
      <p>链接可能有误或已失效，请联系管理员。</p>
      <a class="button block" href="/">
        回到首页
      </a>
    </Page>
  );
}
