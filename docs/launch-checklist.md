# 上线检查清单

网站已经部署在 https://jaysbadminton.llmat.dev 。功能都有自动测试（单元测试 + 用真实浏览器走完整流程）覆盖，但下面这些涉及**真实的账号、手机和第三方服务**，需要人工确认一遍。逐项打勾即可。

## 一、交接前（网站维护者）

- [ ] GitHub 仓库 Settings → Secrets 里有：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_PASSWORD`、`TELEGRAM_BOT_TOKEN`、`GOOGLE_MAPS_API_KEY`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`RESEND_API_KEY`、`EMAIL_FROM`、`LINK_ENCRYPTION_KEY`（正式网站管理员备份密钥后由维护者存入；测试环境另有 `ADMIN_PASSWORD_STAGING`、`TELEGRAM_BOT_TOKEN_STAGING`、`LINK_ENCRYPTION_KEY_STAGING`）
- [ ] 把 `ADMIN_PASSWORD` 改成一个给新管理员用的临时密码，然后 Actions → CI → Run workflow（Use workflow from 选最新的版本标签）运行一次
- [ ] 管理页 → 设置 → 危险操作 → **清空所有数据**，删掉测试数据。交接时必须用它：只要还有管理链接，`/admin` 的初次设置就会被拒绝，新管理员没法成为 Owner。（网站已经在用、只想删掉几个测试活动时，改用活动详情页底部的**从数据库永久删除**，只能删已取消或已收齐归档的活动，不会动到成员和设置。）
- [ ] Cloudflare → Email Routing（jaysbadminton.llmat.dev）：`venmo@` 的规则是 **Send to a Worker → jaysbadminton**
- [ ] 把网址 `https://jaysbadminton.llmat.dev/admin` 和临时密码交给新管理员

## 二、管理员第一次设置

按管理页「设置 → 管理员指南」走一遍，清单会自动打勾：

- [ ] 在 `/admin` 做初次设置（成为 Owner），收藏管理链接，**把密码改成自己的**
- [ ] 收款设置：Venmo 用户名、Venmo 通知邮箱、Zelle
- [ ] 连接 Telegram，发送测试消息；再给机器人发「管理页面」，确认能找回链接
- [ ] 设置 → **备份网站密钥**（管理员指南里没有这一步，不会自动打勾；需要能改 GitHub 仓库的人一起做）：输入管理密码，把密钥发到 Telegram，存进密码管理器，并存成 GitHub secret `LINK_ENCRYPTION_KEY`（测试网站是 `LINK_ENCRYPTION_KEY_STAGING`），然后删掉那条消息。下一次部署的日志里会显示「matches」，说明备份对得上
- [ ] Gmail 转发：添加转发地址（确认码会出现在 Telegram）→ 创建 `from:venmo@venmo.com` 过滤器
- [ ] 设置 → 用 Google 登录管理页：绑定自己的 Google 账号（并给它开启两步验证），退出后用 Google 登录，确认能直接进入管理页
- [ ] 提醒设置（含每周健康简报）、默认外观、网站标题、排行榜开关
- [ ] （可选）Google 表格同步：建表格 → 粘贴脚本 → 运行 `install`，表格里出现各个标签页

## 三、真实环境验证

- [ ] **微信里打开**（iPhone 和 Android 各找一台，深色模式也看一眼）：首页、活动页、成员专属链接，按钮和文字都正常显示
- [ ] **Google 申请**：请一位群友在首页用 Google 申请 → 待审核里通过 → 对方用 Google 登录后能报名、在活动页看到名单
- [ ] **Venmo 按钮**：在微信里点「用 Venmo 付」→ 按提示「在浏览器中打开」→ 跳到 Venmo，收款人、金额、备注都已填好
- [ ] **Venmo 自动对账**：建一个小的测试活动，用另一个 Venmo 账号按备注编号付款 → 几分钟内自动标记已付 → Telegram 收到消息；管理员指南里的「转发状态」显示验证通过
- [ ] **无关收款被忽略**：请朋友付 $1、备注随便写 → 转发状态显示「当作无关收款忽略」，收款页里不出现
- [ ] **定时提醒**：第一次真实活动时，留意截止前提醒、截止名单、结算提醒、账单提醒是否按时到 Telegram
- [ ] **收齐**：所有人付清后，Telegram 收到带日期、场馆、费用明细的收齐存档消息

## 四、日常维护

| 事情 | 怎么做 |
| --- | --- |
| 试新功能 | 合并到 `main` 后自动部署到**测试环境** https://staging.jaysbadminton.llmat.dev （顶部有黄色「测试环境」横幅，数据和正式网站分开，可以随便试） |
| 发布到正式网站 | 测试环境确认没问题后，运行 GitHub → Actions → **Release**（分支选 `main`）或让 Claude「发布」，自动打上 `vYYYY.MM.DD` 标签并发布 Release；也可以在 GitHub → Releases 手动新建标签。会先备份正式数据库，再部署，并自动检查线上网站 |
| 回滚 | GitHub → Actions → CI → Run workflow → Use workflow from 选要回到的版本标签 → Run。会先跑一遍检查和测试再部署，约 2–3 分钟。只能回滚到 migrations 文件夹里已经包含数据库执行过的全部迁移的版本，也就是不早于最近一次新增迁移的那个版本（在那个标签上 `ls migrations/` 可以看到）；更早的版本要先用发布前的数据库备份恢复数据库（见 README「回滚的限制」） |
| 出问题看哪里 | GitHub → Actions 看部署记录；Cloudflare → Workers → jaysbadminton → Logs 看运行日志 |
| 数据恢复 | Cloudflare D1 自带 7 天「时间回溯」；每次发布前的数据库备份在那次 Actions 运行的 Artifacts 里（保存 90 天）；开了 Google 表格同步的话，表格的「版本记录」里也有每天的数据 |
| 忘记管理链接 | Telegram 给机器人发「管理页面」；或者 Actions → CI → Run workflow，Use workflow from 选**最新的版本标签**，勾选 `reset_admin_link`（正式环境，密码是 `ADMIN_PASSWORD`）；测试环境则选 **main**，密码是 `ADMIN_PASSWORD_STAGING` |
| 忘记管理密码 | 改 GitHub 里的 `ADMIN_PASSWORD`，再在**最新的版本标签**上运行一次 CI |
| 换管理员 | 设置 → 清空所有数据，新管理员重新做初次设置 |
| 费用 | 全部在免费额度内：Cloudflare Workers/D1/邮件路由免费版、Telegram 免费、Google 地址联想在每月免费调用次数内 |
