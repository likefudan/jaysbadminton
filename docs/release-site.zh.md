# 发布管理网站 badminton.llmat.dev

用手机或电脑打开 https://badminton.llmat.dev ，用 Google 登录。GitHub secret `OPS_EMAIL` 里的邮箱是管理者（Ke Li），什么都能做。

## 用户和权限

- 其他人用 Google 登录后只看到一张申请表（名字 + 可不填的说明），看不到任何站点、版本或部署信息。提交后开发群收到一条「📝 谁 申请使用发布管理网站」。
- 管理者在首页「用户和权限」（有新申请时带红色数字）里处理：**批准（只读）**、**批准为发布工程师**、**拒绝**；之后可以随时改为只读、设为发布工程师、取消权限；被拒绝或取消的人不能再申请，「删除」后可以重新申请。只有管理者能看到和改这里。
- **只读**：能看整个页面（新改动、各站点版本、所有版本和发布说明、最近的部署），但没有发布按钮，也不能选版本。
- **发布工程师**：和管理者一样可以发布、回滚、恢复备份，只是不能管理用户。开发群的发布通知会写是谁开始的。
- 权限每次请求都重新读，取消后对方马上不能再用（不用等 7 天的登录过期）。名单存在这个 Worker 自己的 Durable Object（`OpsUsers`）里，不需要另外设置；最多 200 个账号（含申请中的）。

- **新版本可以发布**：main 上还没发布的改动。勾选要发布的站点，按「发布 v…」。测试站的 CI 没通过时按钮是灰的。发布的就是页面上列出的这些改动：如果页面打开之后 main 上又合并了新的改动，会提示并刷新，看过再按一次。
- **各站点**：每个站点正在跑的版本（读它的 `/api/health`）、能不能打开、落后几个版本。「升到最新」把最新版本发到这个站点；「更换版本」可以选别的版本，包括回滚。早于这个站点数据库迁移的版本会锁住（要先恢复备份，见 README「回滚的限制」）；只加新表、旧版本不读的迁移列在 `scripts/rollback-safe-migrations.json` 里，不会锁，回到旧版本时 Release 先把它们放到一边，下次升级再执行一次，CI 部署前还会再检查一次。换到已有的版本不再重跑测试（它当初在 main 上通过了）。`v2026.11.09` 和更早的版本太旧，不能在这里换（见 README「回滚」）。站点还没用新流程发布过时显示「版本未知」，发布一次之后就有了。
- **最近的部署**：每次部署到了哪些站点，点开看 GitHub 上的运行记录。有站点失败时，每个站点后面各有 ✓ 或 ✗。

每个按钮做的事和在 GitHub → Actions → Release 里手动运行完全一样：先备份每个选中站点的数据库，再迁移、部署、冒烟测试、发更新通知。代码在 `ops/`，合并到 main 时自动部署（CI 的 `deploy-ops`），它不跟着正式版发布走；它部署失败不会挡住正式站发布，开发者的 Telegram 群会收到一条提醒。

## 第一次设置（只做一次）

1. **GitHub 令牌**：GitHub → 右上角头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。Repository access 选 Only select repositories → `jaysbadminton`；Permissions 里 Actions 选 Read and write，Contents 选 Read-only。有效期可以选 1 年（到期后重新生成一个，替换下面的 secret）。生成后复制。
2. 仓库 → Settings → Secrets and variables → Actions → New repository secret：
   - `OPS_GITHUB_TOKEN`：上一步的令牌。
   - `OPS_EMAIL`：管理者的 Google 邮箱（批准别人、给发布工程师权限的人）。
3. **Google 登录**：Google Cloud → APIs & Services → Credentials → 现有的 OAuth 客户端 → Authorized redirect URIs 加上 `https://badminton.llmat.dev/auth/callback`。
4. 重新运行一次 main 上的 CI（或者等下一次合并），secret 就会推到网站上。

登录密钥 `OPS_SESSION_KEY` 由 CI 第一次部署时自动生成，不需要备份（丢了只是要重新登录）。登录 7 天有效；「退出」只清这台设备的登录，要让所有设备的登录马上失效，在 Cloudflare 里删掉这个 Worker 的 `OPS_SESSION_KEY` 再重新运行一次 main 上的 CI。

GitHub 令牌到期后页面会显示「GitHub …: 401」，按第 1、2 步换一个新的就行；建议在到期前设一个提醒。这个令牌除了发布，还能删除 Actions 的运行记录和产物（数据库备份就在里面），所以 `BACKUP_KEY` 和重要的备份最好自己另存一份。

## 恢复备份并换版本

被锁住（「需恢复 🔒」）的版本也可以选：按钮变成红色的「恢复备份并换到 …」，确认时要输入站点代号（例如 `jays`）。然后 Actions 里的 Restore 工作流会：先把这个站点现在的数据库加密备份（Artifacts，保存 90 天）；用 Cloudflare D1 的时间回溯把数据库恢复到它第一次执行这个版本没有的迁移之前一分钟（只能回到 30 天以内）；再用 Release 把这个版本发到这个站点。恢复点之后这个站点的报名、付款和设置改动会丢失，其他站点不受影响。开始时开发群会收到通知。
