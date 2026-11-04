# 给另一个群开独立站点

每个群一个独立站点：自己的 Worker、自己的 D1 数据库、自己的域名和 Telegram 机器人，代码和 Jay's 正式站是同一份。两个站点的数据完全分开。

站点列在仓库根目录的 `sites.json` 里，每个站点一行：

```json
[{ "id": "sbbc", "domain": "sbbc.llmat.dev", "name": "SBBC 羽毛球", "icon": "blue" }]
```

- `id`：站点代号，定了就不要改（Worker 叫 `jaysbadminton-<id>`，数据库同名，密钥也由它算出来）。
- `domain`：站点地址，用 `llmat.dev` 的子域名最省事。
- `name`：网站名，群主可以在设置里改。
- `sponsor`（可不写）：页脚「AI 服务由 … 赞助」那一行。不写就和正式站一样（Z3 Enterprise）；写 `null` 不显示；写 `{ "name": "…", "url": "https://…" }` 换成别的赞助商。
- `icon`（可不写）：图标颜色。不写就是正式站的珊瑚色；写 `"blue"` 或 `"green"` 用 `src/web/public/site-icons/<颜色>/` 里的蓝色或绿色图标（标签页、主屏幕 App、分享卡、链接预览和顶栏 logo 都换）。要别的颜色，先用 `node scripts/site-icons.cjs <名字> <浅色> <深色> <山的颜色>` 生成一套。

每次发布（Actions → Release）先部署正式站，再对列表里的每个站点各做一遍：备份数据库（`db-backup-<id>-<版本>`）、迁移、部署、冒烟测试、给这个站点的群主和管理员发更新通知。

## 共用的两个 GitHub secret（只设一次）

- `SITES_KEY`：一串随机字符（例如 `openssl rand -base64 32`）。每个站点的加密密钥由它和站点代号算出来，所以它就是所有站点的密钥备份，丢了站点里的链接就打不开了，请存进密码管理器。
- `SITES_ADMIN_PASSWORD`：新站点第一次设置用的群主密码。群主设置好以后在「设置」里改成自己的。以后改这个 secret 会把所有站点的群主密码重置成它。

没有这两个 secret 时，发布照常进行，只是跳过这些站点。

## 加一个新站点

1. 在 `sites.json` 加一行，合并，然后发布。第一次发布会自动建 Worker、数据库和域名。
2. Google 登录：Google Cloud → 凭据 → 现有的 OAuth 客户端 → 已获授权的重定向 URI，加上 `https://<domain>/api/auth/google/callback`。
3. Turnstile：Cloudflare → Turnstile → 现有的小组件 → 主机名，加上 `<domain>`。
4. Google Maps key 如果限制了网站来源，加上 `https://<domain>/*`。
5. 收 Venmo 邮件：Cloudflare → `llmat.dev` → Email Routing，给子域名 `<domain>` 开启邮件路由，再加规则 `venmo@<domain>` → Send to a Worker → `jaysbadminton-<id>`。
6. 新群的群主打开 `https://<domain>/admin`，用 `SITES_ADMIN_PASSWORD` 完成首次设置，然后在「设置」里：改密码、填 Venmo、在「Telegram 通知」里粘贴自己用 @BotFather 建的机器人 token 并连接。
7. 群主在自己的 Gmail 里加过滤器，把 `venmo@venmo.com` 的邮件转发到 `venmo@<domain>`。

站点的加密密钥不需要再备份（设置里的「备份网站密钥」会说明这一点）。
