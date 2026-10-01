# Jay's Badminton

羽毛球群的报名与收费系统：成员通过专属链接报名，Owner 输入场地费和用球数后系统自动算出每人金额，成员点预填的 Venmo 链接付款，系统读取转发来的 Venmo 收款邮件自动标记已付，Owner 在管理页一眼看到钱是否收齐。

A sign-up and fee-collection site for a casual weekly badminton group (~50 members, 20–30 per session). Members sign up through a private link, the Owner enters court and shuttlecock costs, the system splits the bill, members pay through a pre-filled Venmo link, and forwarded Venmo receipt emails mark payments as paid automatically. Notifications go to the Owner on Telegram, ready to paste into WeChat.

- **Site**: https://jaysbadminton.llmat.dev (not deployed yet)
- **Stack**: Cloudflare Workers + D1 + Cron Triggers + Email Routing (free tier), with a daily Google Sheets mirror via Apps Script

## Docs

| Document | Language | What it covers |
| --- | --- | --- |
| [docs/requirements.zh.md](docs/requirements.zh.md) | 中文 | 需求文档：业务规则、页面、费用计算、对账、通知 |
| [docs/technical-design.md](docs/technical-design.md) | English | Architecture, data model, API, email ingestion, jobs, deployment, setup checklist |

## Development

Requires Node.js 22.

```sh
npm install
npm run db:migrate:local   # create the local D1 database
printf 'TOKEN_KEY="dev"\nADMIN_PASSWORD="dev-password"\n' > .dev.vars
npm run dev                # build the front end and serve everything on http://localhost:8787
npm test                   # Vitest inside the Workers runtime, against a local D1
npm run typecheck
```

| Path | Contents |
| --- | --- |
| `src/worker/` | Cloudflare Worker: Hono API, cron and email handlers |
| `src/web/` | Preact front end (built by Vite into `dist/web`, served as static assets) |
| `migrations/` | D1 schema migrations |
| `test/` | Vitest tests |

## Deployment

Every push to `main` runs typecheck, tests and build, then deploys with GitHub Actions (`.github/workflows/ci.yml`): it finds or creates the `jaysbadminton` D1 database, applies migrations and runs `wrangler deploy`, which also attaches the `jaysbadminton.llmat.dev` custom domain.

Repository secrets required:

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → any domain's Overview page, right column |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, add **Account · D1 · Edit**, limit to this account and the `llmat.dev` zone |
| `ADMIN_PASSWORD` | Your choice. Initial admin password, and the recovery path: change it and redeploy to reset a forgotten password |

CI also generates the `TOKEN_KEY` Worker secret on the first deploy and never replaces it.

### First-time setup and recovery

- Open `/admin`, enter `ADMIN_PASSWORD`, and save the admin link and your own member link it shows. The admin page then needs both the link and the password (remembered for 30 days per device).
- **Forgot the password**: change the `ADMIN_PASSWORD` secret, then Actions → CI → Run workflow on `main`.
- **Lost the admin link**: Actions → CI → Run workflow on `main` with `reset_admin_link` ticked, then open `/admin` again.
- **Hand over to a new Owner / start fresh**: admin page → 设置 → 清空所有数据 (phrase + password). Everything except the admin password is deleted; the new Owner then runs first-time setup at `/admin` with that password and changes it. D1 Time Travel can restore the previous 7 days if needed.
