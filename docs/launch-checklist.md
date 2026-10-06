# 上线检查清单

网站已经部署在 https://jaysbadminton.llmat.dev 。功能都有自动测试（单元测试 + 用真实浏览器走完整流程）覆盖，但下面这些涉及**真实的账号、手机和第三方服务**，需要人工确认一遍。逐项打勾即可。

## 一、交接前（网站维护者）

- [ ] GitHub 仓库 Settings → Secrets 里有：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_PASSWORD`、`TELEGRAM_BOT_TOKEN`、`GOOGLE_MAPS_API_KEY`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`RESEND_API_KEY`、`EMAIL_FROM`（测试环境另有 `ADMIN_PASSWORD_STAGING`、`TELEGRAM_BOT_TOKEN_STAGING`；`LINK_ENCRYPTION_KEY` 和 `LINK_ENCRYPTION_KEY_STAGING` 要等第二节备份密钥后再存入）
- [ ] 把 `ADMIN_PASSWORD` 改成一个给新群主用的临时密码，然后 Actions → CI → Run workflow（Use workflow from 选最新的版本标签）运行一次
- [ ] 管理页 → 设置 → 危险操作 → **清空所有数据**，删掉测试数据。交接时必须用它：只要还有管理链接，`/admin` 的初次设置就会被拒绝，新群主没法成为 Owner。（网站已经在用、只想删掉几个测试活动时，改用活动详情页底部的**从数据库永久删除**，只能删已取消或已收齐归档的活动，不会动到成员和设置。）
- [ ] Cloudflare → Email Routing（jaysbadminton.llmat.dev）：`venmo@` 的规则是 **Send to a Worker → jaysbadminton**
- [ ] 把网址 `https://jaysbadminton.llmat.dev/admin` 和临时密码交给新群主

## 二、群主第一次设置

按管理页「设置 → 使用指南」走一遍，清单会自动打勾：

- [ ] 在 `/admin` 做初次设置（成为 Owner），收藏管理链接，**把密码改成自己的**
- [ ] 收款设置：Venmo 用户名、Venmo 通知邮箱、Zelle
- [ ] 连接 Telegram，发送测试消息；再给机器人发「管理页面」，确认能找回链接
- [ ] 设置 → **备份网站密钥**（使用指南里有这一步，但不会自动打勾；需要能改 GitHub 仓库的人一起做）：输入群主密码，把密钥发到 Telegram，存进密码管理器，并存成 GitHub secret `LINK_ENCRYPTION_KEY`（测试网站是 `LINK_ENCRYPTION_KEY_STAGING`），然后删掉那条消息。下一次部署的日志里会显示「matches」，说明备份对得上
- [ ] Gmail 转发：添加转发地址（确认码会出现在 Telegram）→ 创建 `from:venmo@venmo.com` 过滤器
- [ ] 设置 → 用 Google 登录管理页：绑定自己的 Google 账号（并给它开启两步验证），退出后用 Google 登录，确认能直接进入管理页
- [ ] 提醒设置（含每周健康简报）、默认外观、网站标题、排行榜开关
- [ ] （可选）Google 表格同步：建表格 → 粘贴脚本 → 运行 `install`，表格里出现各个标签页

## 三、真实环境验证

- [ ] **微信里打开**（iPhone 和 Android 各找一台，深色模式也看一眼）：首页、活动页、成员专属链接，按钮和文字都正常显示
- [ ] **Google 申请**：请一位群友在首页用 Google 申请 → 待审核里通过 → 对方用 Google 登录后能报名、在活动页看到名单
- [ ] **Venmo 按钮**：在微信里点「用 Venmo 付」→ 按提示「在浏览器中打开」→ 跳到 Venmo，收款人、金额、备注都已填好
- [ ] **Venmo 自动对账**：建一个小的测试活动，用另一个 Venmo 账号按备注编号付款 → 几分钟内自动标记已付 → Telegram 收到消息；使用指南里的「转发状态」显示验证通过
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
| 忘记管理链接 | Telegram 给机器人发「管理页面」；或者 Actions → CI → Run workflow，Use workflow from 选**最新的版本标签**，勾选 `reset_admin_link`（正式环境）；测试环境则选 **main**。之后用当前的群主密码重新设置（没在管理页改过的话，正式环境是 `ADMIN_PASSWORD`，测试环境是 `ADMIN_PASSWORD_STAGING`） |
| 忘记群主密码 | 改 GitHub 里的 `ADMIN_PASSWORD`，再在**最新的版本标签**上运行一次 CI |
| 换群主 | 设置 → 清空所有数据，新群主重新做初次设置 |
| 费用 | 全部在免费额度内：Cloudflare Workers/D1/邮件路由免费版、Telegram 免费、Google 地址联想在每月免费调用次数内 |

## 五、打开组织者功能（正式网站）

组织者功能（[设计](design/organizers.zh.md)、[任务卡](design/organizers-tasks.zh.md)）已经合并到 `main`，测试环境的功能开关 `ORGANIZERS` 是打开的；正式网站的开关是 `"0"`，而且正式网站目前的版本（v2026.10.03.5）还没有这些代码。顺序是：先在测试环境演练，再发布一次开关关着的版本，最后打开开关。

### 1. 测试环境演练（群主 + 一位真实组织者）

在 https://staging.jaysbadminton.llmat.dev 上做。测试环境的数据、Telegram 机器人和正式网站分开，可以放心试。

- [ ] 准备收邮件：Cloudflare → `llmat.dev` → Email Routing 里给 `staging.jaysbadminton.llmat.dev` 这个子域名也开启邮件路由（会加上它的 MX 记录），再加一条规则：`venmo@staging.jaysbadminton.llmat.dev` → **Send to a Worker → jaysbadminton-staging**。已经有的话跳过。没有它，测试环境收不到 Gmail 确认邮件和 Venmo 邮件
- [ ] 群主在测试环境连好自己的 Telegram、填好收款设置，并在自己的 Gmail 里**另加一个**过滤器：`from:venmo@venmo.com` 转发到 `venmo@staging.jaysbadminton.llmat.dev`（原来转发到正式网站的那个保留不动）
- [ ] 组织者先用 Google 在测试环境申请入群，群主在「待审核」里通过
- [ ] **任命**：成员页点他的「设为组织者」→ 他收到邮件；他用 Google 登录后，头像菜单里有「管理页」
- [ ] **组织者设置**：他在「设置」里按「给组织者的说明」走一遍：填收款设置（Venmo 用户名、通知邮箱）、在自己的 Gmail 里加同样的转发到 `venmo@staging.jaysbadminton.llmat.dev` 的过滤器（Gmail 的确认码会显示在他的设置页）、连接自己的 Telegram 并发测试消息。群主成员页的「组织者」区块里收款设置和 Telegram 显示已就绪；转发要等第一封 Venmo 收款邮件到了（下面「自动对账」那步）才显示已生效
- [ ] **发起活动**：他新建一场活动 → 群主的 Telegram 收到「新活动发起」抄送；群主的活动列表里这场的负责人是他
- [ ] **报名**：群主和另外一两个人用成员页报名；卡片上写「组织：某某」
- [ ] **截止**：他点「立即截止报名」（或等到截止时间）→ 截止通知发到**他的** Telegram
- [ ] **Finalize**：他填费用并 Finalize → 他的 Telegram 收到结算完成，群主收到抄送；成员账单写「付给 某某」，Venmo 按钮的收款人是他
- [ ] **自动对账**：一位成员用 Venmo 按账单付给他（小额即可）→ 几分钟内账单自动变成已付，他的「转发状态」显示已生效
- [ ] **付错人**：再有人把带这场付款编号的钱付给**群主**的 Venmo → 群主的「收款 › 待确认」里出现，原因写「付到了 … 的账户，但这场的收款人是 某某」；群主在待确认里把它关联到这场的账单，账单的付款记录上标明钱在群主的账户（两人自己结算）
- [ ] **退款**：有人多付一次 → 进入「需要退款」，他退回后点「已退款」
- [ ] **收齐**：全部付清 → 活动自动归档，他和群主都收到收齐消息
- [ ] **撤销**：群主在成员页点「撤销组织者」，弹窗列出受影响的活动 → 他的 Google 进不了管理页，收到撤销邮件；他的 Telegram 被断开
- [ ] 每一步之后看一眼这场活动底部的「操作记录」，写的人和事都对
- [ ] 演练完，群主和组织者都删掉指向测试环境的那个 Gmail 过滤器

### 2. 发布开关关着的版本

- [ ] `wrangler.jsonc` 顶层 `vars` 里保持 `"ORGANIZERS": "0"`，运行 **Release** 发布（会先备份正式数据库，并执行迁移 `0023`、`0024`）。正式网站上群主和成员看到的和以前一样，主要多了「管理员」改称「群主」、活动底部的「操作记录」和导出的几列
- [ ] 用几天，确认没有问题。这样万一以后要紧急关掉开关，回到的是一个正式网站上已经跑过的状态

### 3. 打开开关（群主说要打开以后）

- [ ] 把 `"ORGANIZERS": "0"` 改为 `"1"`，合并到 `main`，再运行 **Release**
- [ ] 发布后：群主用 Google 登录正式网站 → 成员页能看到「设为组织者」；任命第一位组织者，让他按「给组织者的说明」设置好再发起活动
- [ ] 组织者在自己的 Gmail 里加转发到 `venmo@jaysbadminton.llmat.dev` 的过滤器（和群主的一样）

**紧急关掉**：把 `"ORGANIZERS"` 改回 `"0"` 再发布。组织者马上进不了管理页，他负责的活动的通知改发群主（消息开头写明原因），群主照样能在管理页管这些活动（改名单、结算、标记已付）。钱照常按收款人走：已经由组织者收款的活动，账单仍然显示他的 Venmo，自动对账照常记账。开关关着时任命、撤销组织者和「转交」都用不了，成员页的「组织者」区块也不显示，所以他的活动仍记在他名下；重新打开开关后他就能接着管。注意：他的活动还没 Finalize 的，群主这时 Finalize 的话，账单仍然付给他（收款人是他），而他已经进不了管理页。所以关掉之前最好先撤销他（还没结算的活动会转给群主），或者先不结算他的活动，等重新打开开关后转交或撤销。

**回滚边界**：第 2 步发布以后，迁移 `0023`、`0024` 已经在正式数据库上执行，之后只能回滚到包含这两个迁移的版本（见上面「回滚」）。打开开关本身不加迁移。有了组织者收款的活动以后，不认识 `payee_id` 的旧版本会把他的活动的账单显示成群主的 Venmo，所以更不能回到那些版本。
