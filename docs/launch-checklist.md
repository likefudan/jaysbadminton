# 上线检查清单

网站已经部署在 https://jaysbadminton.llmat.dev 。功能都有自动测试（单元测试 + 用真实浏览器走完整流程）覆盖，但下面这些涉及**真实的账号、手机和第三方服务**，需要人工确认一遍。逐项打勾即可。

## 一、交接前（网站维护者）

- [ ] GitHub 仓库 Settings → Secrets 里有：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_PASSWORD`、`TELEGRAM_BOT_TOKEN`、`GOOGLE_MAPS_API_KEY`
- [ ] 把 `ADMIN_PASSWORD` 改成一个给新管理员用的临时密码，然后 Actions → CI → Run workflow（Use workflow from 选最新的版本标签）运行一次
- [ ] 管理页 → 设置 → 危险操作 → **清空所有数据**，删掉测试数据
- [ ] Cloudflare → Email Routing（jaysbadminton.llmat.dev）：`venmo@` 的规则是 **Send to a Worker → jaysbadminton**
- [ ] 把网址 `https://jaysbadminton.llmat.dev/admin` 和临时密码交给新管理员

## 二、管理员第一次设置

按管理页「设置 → 管理员指南」走一遍，清单会自动打勾：

- [ ] 在 `/admin` 做初次设置（成为 Owner），收藏管理链接，**把密码改成自己的**
- [ ] 收款设置：Venmo 用户名、Venmo 通知邮箱、Zelle
- [ ] 连接 Telegram，发送测试消息；再给机器人发「管理页面」，确认能找回链接
- [ ] Gmail 转发：添加转发地址（确认码会出现在 Telegram）→ 创建 `from:venmo@venmo.com` 过滤器
- [ ] 提醒设置（含每周健康简报）、默认外观、网站标题、排行榜开关
- [ ] （可选）Google 表格同步：建表格 → 粘贴脚本 → 运行 `install`，表格里出现各个标签页

## 三、真实环境验证

- [ ] **微信里打开**（iPhone 和 Android 各找一台，深色模式也看一眼）：首页、活动页、成员专属链接，按钮和文字都正常显示
- [ ] **Venmo 按钮**：在微信里点「用 Venmo 付」→ 按提示「在浏览器中打开」→ 跳到 Venmo，收款人、金额、备注都已填好
- [ ] **Venmo 自动对账**：建一个小的测试活动，用另一个 Venmo 账号按备注编号付款 → 几分钟内自动标记已付 → Telegram 收到消息；管理员指南里的「转发状态」显示验证通过
- [ ] **无关收款被忽略**：请朋友付 $1、备注随便写 → 转发状态显示「当作无关收款忽略」，收款页里不出现
- [ ] **定时提醒**：第一次真实活动时，留意截止前提醒、截止名单、结算提醒、账单提醒是否按时到 Telegram
- [ ] **收齐**：所有人付清后，Telegram 收到带日期、场馆、费用明细的收齐存档消息

## 四、日常维护

| 事情 | 怎么做 |
| --- | --- |
| 试新功能 | 合并到 `main` 后自动部署到**测试环境** https://staging.jaysbadminton.llmat.dev （顶部有黄色「测试环境」横幅，数据和正式网站分开，可以随便试） |
| 发布到正式网站 | 测试环境确认没问题后，打一个版本标签 `vYYYY.MM.DD`（GitHub → Releases → Draft a new release → 新建标签 → Generate release notes → Publish，或让 Claude「发布」）。会先备份正式数据库，再部署，并自动检查线上网站 |
| 回滚 | GitHub → Actions → CI → Run workflow → Use workflow from 选上一个版本标签 → Run。约 1 分钟恢复到上个版本 |
| 出问题看哪里 | GitHub → Actions 看部署记录；Cloudflare → Workers → jaysbadminton → Logs 看运行日志 |
| 数据恢复 | Cloudflare D1 自带 7 天「时间回溯」；每次发布前的数据库备份在那次 Actions 运行的 Artifacts 里（保存 90 天）；开了 Google 表格同步的话，表格的「版本记录」里也有每天的数据 |
| 忘记管理链接 | Telegram 给机器人发「管理页面」；或者 Actions → CI → Run workflow，Use workflow from 选**最新的版本标签**，勾选 `reset_admin_link` |
| 忘记管理密码 | 改 GitHub 里的 `ADMIN_PASSWORD`，再在**最新的版本标签**上运行一次 CI |
| 换管理员 | 设置 → 清空所有数据，新管理员重新做初次设置 |
| 费用 | 全部在免费额度内：Cloudflare Workers/D1/邮件路由免费版、Telegram 免费、Google 地址联想在每月免费调用次数内 |
