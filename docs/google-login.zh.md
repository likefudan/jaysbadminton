# Google 登录配置

## 用户体验

Google 登录成功后，各页面右上角显示 Google 账号头像和登录状态小圆点；没有头像或加载失败时显示彩色 Google 标志。点击可查看当前登录邮箱、进入「我的活动」或退出登录；未登录时不显示此标志。代码请求 `openid email profile`，头像来自已验证的 Google ID token。旧会话仍可使用，退出后重新登录即可获取头像，不影响成员绑定和报名记录。

首页和活动页点击「登录 / 我的活动」，选择 Google 账号，第一次填写用户名和微信昵称即可成为普通成员并报名，不需要管理员生成或发送链接。以后进入 `/me` 会直接显示自己的活动、账单和统计。

旧成员先打开原成员链接，点击「绑定 Google 账号」，登录后确认绑定；也可以在首次登录页选择「已有成员链接？关联原账号」。这样成员编号、历史报名和账单都保留。不会按姓名或邮箱猜测并合并成员；同一个 Google 账号只关联一个成员。旧成员链接仍有效，管理员可重新生成备用链接。

**一个 Google 账号只对应一个人**，成员和管理员都一样：每个账号最多绑定一个成员记录，每个成员（包括管理员）也最多绑定一个 Google 账号。

**管理员用 Google 登录**：管理员（Owner）在管理页「设置 → 用 Google 登录管理页」里，把当前浏览器登录的 Google 账号绑定到自己（只能绑一个，换账号要先解除绑定）。已经属于某个成员的 Google 账号不能再绑给管理员。绑定后用这个账号登录 Google，在首页头像菜单、`/admin` 或「我的活动」里点「管理页」即可进入 `/admin/google`，不需要管理链接和密码；其他 Google 账号打不开。管理链接和密码照常可用，作为备用。请给绑定的 Google 账号开启两步验证。

除此之外，Google 登录只授予成员权限。用 Google 新注册的人和「申请加入」一样进入「待审核」，管理员通过后才能报名（待审核列表会显示申请人的 Google 邮箱）。停用成员只能查看活动账单，不能报名。删除成员后，他的历史记录保留，但 Google 账号会被释放：同一个邮箱可以重新申请，审核通过后得到一个新的成员编号（旧成员不会被恢复）。

## 1. 创建 Google OAuth Client

打开 https://console.cloud.google.com/ ，选择项目或新建项目，然后进入 **Google Auth Platform**：

1. 在 **Branding** 配置应用名称、支持邮箱、开发者联系邮箱。
2. 在 **Audience** 选择 **External**。开发期间使用 **Testing**，在 Test users 中添加你用来测试的 Gmail 账号。
3. 在 **Data Access** 使用 OpenID、邮箱和基本资料范围（代码请求 `openid email profile`），不需要 Gmail 邮件读写权限。
4. 在 **Clients → Create client** 创建 **Web application**。
5. 添加 **Authorized redirect URIs**，必须完全一致：
   - 本地：`http://localhost:8787/api/auth/google/callback`
   - 正式站：`https://jaysbadminton.llmat.dev/api/auth/google/callback`
   - 测试环境：`https://staging.jaysbadminton.llmat.dev/api/auth/google/callback`
6. 保存 Client ID 和 Client Secret。

这里采用服务端跳转登录，不依赖浏览器 Google JavaScript SDK，不需要为 SDK 添加 JavaScript origins。若更换域名或端口，需要同步修改 redirect URI 和 `SITE_ORIGIN`。测试完成后，在 Audience 中按 Google 控制台要求发布应用，以便测试名单以外的用户使用。

官方文档：https://developers.google.com/identity/openid-connect/openid-connect

## 2. 配置本地

编辑仓库中已被 Git 忽略的 `.dev.vars`，保留原有 TOKEN_KEY 和 ADMIN_PASSWORD，追加：

```dotenv
GOOGLE_CLIENT_ID="你的 Web Client ID"
GOOGLE_CLIENT_SECRET="你的 Web Client Secret"
```

不要将 Client Secret 提交到 Git 或发送到聊天。仓库的 `.dev.vars.example` 只是格式参考。

在终端启动（先使用工作区的开发环境脚本，以加载 Node）：

```sh
source '/Users/dafeinmacair/Documents/ChatGPT/羽毛球社群/开发环境.sh'
npm run db:migrate:local
npm run dev -- --ip 127.0.0.1 --var SITE_ORIGIN:http://localhost:8787
```

现有工作区的 `启动项目.command` 已包含上述 SITE_ORIGIN 参数。使用浏览器打开 **http://localhost:8787**，不要把 127.0.0.1 与 localhost 混用，否则登录状态 cookie 不属于同一个主机。修改 `.dev.vars` 后重启服务。

缺少 Client ID 或 Secret 时，登录页会说明 Google 登录尚未开通，原成员链接仍可用。

## 3. 配置正式部署

在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

现有 CI 已接入这两项，通过 `scripts/sync-secrets.mjs` 写入测试环境和正式站各自的 Cloudflare Worker secrets（两边共用同一个 OAuth client，所以上面两个 redirect URI 都要加）。部署会应用 `0009_google_auth.sql`。`wrangler.jsonc` 里两个环境的 `SITE_ORIGIN` 必须与各自域名一致。PR 验证通过后再按团队流程合并：合并到 main 只部署测试环境，打 `v*` 版本标签才部署正式站。

也可通过 `npx wrangler secret put GOOGLE_CLIENT_ID` 和 `npx wrangler secret put GOOGLE_CLIENT_SECRET` 交互设置 Worker secrets。不要把 Secret 写进 wrangler.jsonc。

## 4. 联调清单

### 正式站显示「尚未启用 Google 登录」

这表示运行中的 Worker 缺少 `GOOGLE_CLIENT_ID` 或 `GOOGLE_CLIENT_SECRET`，不是成员权限或审批问题。本地 `.dev.vars` 不会随 Git 推送上线。网站维护者只需按第 3 节配置一次，之后所有已有成员可自行授权并确认绑定，无需管理员逐人处理。

确认 Google Client 的 Authorized redirect URIs 包含 `https://jaysbadminton.llmat.dev/api/auth/google/callback`。在 Cloudflare 的 `jaysbadminton` Worker 配置两个 Secret，或将其保存到 GitHub Actions Secrets 后，在最新的版本标签上重新运行部署（Actions → CI → Run workflow → Use workflow from 选 v 开头的标签）。不要复制 `.dev.vars` 中的其他本地密钥覆盖生产密钥。

部署后访问 `https://jaysbadminton.llmat.dev/api/auth/session`，应返回 `enabled: true`。旧成员页面会直接跳转 Google 授权，返回后确认绑定；即使账号已登录，也会先确认原成员链接，避免误进入另一个成员账号。重复确认同一个绑定会成功，已绑定到其他成员的 Google 账号仍会被拒绝。

- 使用测试 Gmail 登录并提交申请，页面显示「申请已提交」、不能报名；管理员在「待审核」通过后，刷新即可报名；退出后再次登录回到同一成员。
- 使用原成员链接绑定另一个 Google 测试账号，确认历史记录保留。
- 用户取消授权后可重试；不同浏览器登录也能找到相同成员。
- 停用成员后不能报名；删除成员后，同一 Google 账号登录会看到「申请加入」，可以重新申请并拿到新编号；普通 Google 账号不能访问管理 API。

自动化测试使用临时 RSA 密钥签发测试 ID token，并模拟 Google token/JWKS 响应，不会访问真实 Google 账号。创建真实 Client 后仍需完成以上真实登录联调。

## 实现说明

- Authorization Code + PKCE（S256）、随机 state 和 nonce；登录请求有效期 10 分钟，回调消费 state 后不可重放。
- jose 根据 Google JWKS 验证 RS256 签名、issuer、audience、exp、nonce、email_verified 和可选 azp；以 Google `sub` 作为稳定身份，不以可变化的邮箱作为主键。
- 服务端保存随机 session 的 SHA-256 摘要，浏览器使用 HttpOnly、SameSite=Lax cookie；HTTPS 下启用 Secure，本地 HTTP 开发可用。有效期 30 天，退出立即删除当前 session。
- 成员 cookie 写操作检查请求 Origin；不存储 Google access/refresh token。
- 管理员的 Google 身份就是 Owner 成员记录上的 `google_sub`（同一个唯一索引保证一一对应）。`/api/admin/google/*` 只在当前 Google 会话属于 Owner 时放行，写操作同样检查 Origin（Google cookie 是 SameSite=Lax，管理员密码 cookie 是 Strict）。修改密码、清空数据仍要输入管理密码。
- `/api/auth/google?next=` 只接受本站的 `/me` 和 `/admin/...` 路径，登录完成后回到原页面。
- `/api/m/session/*` 使用当前 cookie 身份，兼容原来的 `/api/m/:token/*`。`/api/auth/*` 位于现有 Worker API 路由范围内。
- 停用的成员保留 `google_sub`，同一账号登录仍是这个（停用的）成员，不能借新注册绕过停用；删除成员时清空 `google_sub`（保留 `google_email` 作记录），让这个人能重新申请。新申请一律是待审核，计入待审核上限。管理页的全站重置同时清空 Google 会话和 OAuth state。
