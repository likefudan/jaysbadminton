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
