# 发布管理网站 badminton.llmat.dev

用手机或电脑打开 https://badminton.llmat.dev ，用 Google 登录（只认 GitHub secret `OPS_EMAIL` 里的那一个邮箱）。

- **新版本可以发布**：main 上还没发布的改动。勾选要发布的站点，按「发布 v…」。测试站的 CI 没通过时按钮是灰的。
- **各站点**：每个站点正在跑的版本（读它的 `/api/health`）、能不能打开、落后几个版本。「升到最新」把最新版本发到这个站点；「更换版本」可以选别的版本，包括回滚。早于这个站点数据库迁移的版本会锁住（要先恢复备份，见 README「回滚的限制」），CI 部署前还会再检查一次。
- **最近的部署**：每次部署到了哪些站点，点开看 GitHub 上的运行记录。

每个按钮做的事和在 GitHub → Actions → Release 里手动运行完全一样：先备份每个选中站点的数据库，再迁移、部署、冒烟测试、发更新通知。代码在 `ops/`，合并到 main 时自动部署（CI 的 `deploy-ops`），它不跟着正式版发布走。

## 第一次设置（只做一次）

1. **GitHub 令牌**：GitHub → 右上角头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。Repository access 选 Only select repositories → `jaysbadminton`；Permissions 里 Actions 选 Read and write，Contents 选 Read-only。有效期可以选 1 年（到期后重新生成一个，替换下面的 secret）。生成后复制。
2. 仓库 → Settings → Secrets and variables → Actions → New repository secret：
   - `OPS_GITHUB_TOKEN`：上一步的令牌。
   - `OPS_EMAIL`：允许登录的 Google 邮箱。
3. **Google 登录**：Google Cloud → APIs & Services → Credentials → 现有的 OAuth 客户端 → Authorized redirect URIs 加上 `https://badminton.llmat.dev/auth/callback`。
4. 重新运行一次 main 上的 CI（或者等下一次合并），secret 就会推到网站上。

登录密钥 `OPS_SESSION_KEY` 由 CI 第一次部署时自动生成，不需要备份（丢了只是要重新登录）。登录 7 天有效。
