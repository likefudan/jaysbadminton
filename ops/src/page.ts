import { LANGS, type Lang, MESSAGES, tr } from "./i18n";
import { TAG } from "./logic";
import { MAX_NOTE, type Role, type User } from "./users";

// The release site's page: a shell, its stylesheet and its script (no inline code, so the content policy
// allows only this site's own files). The script draws everything from /api/state.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ERRORS: Record<string, string> = {
  login: "登录没有完成，请再试一次。",
  account: "这个 Google 账号不能用（邮箱还没有验证）。",
  name: "请填写你的名字。",
  full: "申请的人太多了，请稍后再试。",
  decided: "这个账号的申请已经处理过了。",
};

/** A signed-in account that is not approved: the application form, or where its application stands. */
function applyCard(
  t: (k: string, v?: Record<string, string>) => string,
  email: string,
  user: User | null,
  owner: string,
  error: string | null,
) {
  const err = error && ERRORS[error] ? `<p class="warn">${t(ERRORS[error])}</p>` : "";
  const as = `<p class="muted">${esc(t("已登录：{email}", { email }))}</p>`;
  if (user?.status === "rejected")
    return `<div class="card login"><b>${t("这个账号没有权限")}</b>${as}<p class="muted">${esc(t("有需要请直接联系 {owner}。", { owner }))}</p></div>`;
  if (user?.status === "pending")
    return `<div class="card login"><b>${t("申请已提交")}</b>${as}<p>${esc(t("等 {owner} 批准后，刷新这个页面就能看到。", { owner }))}</p>${
      user.note ? `<p class="muted">${esc(t("你写的说明：{note}", { note: user.note }))}</p>` : ""
    }</div>`;
  return `<div class="card"><b>${t("申请使用")}</b>${as}<p>${esc(t("这个网站管理各羽毛球网站的发布。申请后，{owner} 批准了你才能查看；发布、回滚和恢复只有发布工程师可以做。", { owner }))}</p>${err}
<form method="post" action="/apply" class="apply"><label>${t("你的名字")}<input name="name" required maxlength="60" autocomplete="name"></label>
<label>${t("说明（可不填）")}<textarea name="note" maxlength="${MAX_NOTE}" rows="3" placeholder="${esc(t("比如：你是谁，为什么需要"))}"></textarea></label>
<button class="btn p">${t("提交申请")}</button></form></div>`;
}

// The 文A button, as on the badminton sites. A <details> menu of plain links, so it works on the sign-in
// page too, which runs no script.
function langSwitch(lang: Lang): string {
  const now = LANGS.find((l) => l.id === lang)!;
  const items = LANGS.map(
    (l) =>
      `<a role="menuitemradio" aria-checked="${l.id === lang}" lang="${l.id}"${l.id === lang ? ' class="on"' : ""} href="/lang/${l.id}">${l.name}</a>`,
  ).join("");
  return `<details class="lang-switch"><summary class="lang-btn" aria-label="${esc(tr(lang, "语言：{name}", { name: now.name }))}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><text x="1" y="13" font-size="12" font-weight="600">文</text><text x="12.5" y="21.5" font-size="12" font-weight="700">A</text></svg></summary><div class="lang-menu" role="menu">${items}</div></details>`;
}

export function page({
  email,
  role = null,
  user = null,
  owner = "",
  problem,
  error,
  lang = "zh-CN",
}: {
  email: string | null;
  role?: Role | null;
  user?: User | null;
  owner?: string;
  problem: string | null;
  error: string | null;
  lang?: Lang;
}) {
  const t = (key: string, vars?: Record<string, string>) => tr(lang, key, vars);
  const out = email
    ? `<form method="post" action="/logout"><button class="link" title="${esc(email)}">${t("退出")}</button></form>`
    : "";
  let body: string;
  if (problem) body = `<div class="card"><b>${t("还不能用")}</b><p class="muted">${esc(problem)}</p></div>`;
  else if (!email)
    body = `<div class="card login"><p>${t("用 Google 登录。第一次来的人登录后可以申请。")}</p>${
      error && ERRORS[error] ? `<p class="warn">${t(ERRORS[error])}</p>` : ""
    }<a class="btn p" href="/login">${t("用 Google 登录")}</a></div>`;
  else if (!role) body = applyCard(t, email, user, owner, error);
  else body = `<div id="app"><p class="muted center">${t("正在读取…")}</p></div><script src="/app.js"></script>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${t("站点发布管理")}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23e8664f'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/app.css"></head><body>
<header class="top"><b>${t("站点发布管理")}</b><span class="acts">${langSwitch(lang)}${out}</span></header><main class="wrap">${body}</main></body></html>`;
}

export const APP_CSS = `
:root{--bg:#f4f2ef;--card:#fff;--text:#222;--muted:#888;--line:#eee;--soft:#f0ece7;--accent:#e8664f;--hero:#fff7f4;--ok:#2e8b57;--okbg:#eaf6ee;--warn:#c77700;--warnbg:#fff4e0;--bad:#c0392b;--badbg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1f1f1f;--text:#eee;--muted:#999;--line:#2c2c2c;--soft:#2b2b2b;--hero:#2a1f1c;--ok:#5cc489;--okbg:#18301f;--warn:#e0a040;--warnbg:#33270f;--bad:#ef7b6e;--badbg:#3a1c19}}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"PingFang SC","Noto Sans CJK SC",system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:15px;-webkit-text-size-adjust:100%}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;padding-top:max(14px,env(safe-area-inset-top));background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
.top b{font-size:17px}
.acts{display:flex;align-items:center;gap:10px}
.lang-switch{position:relative}
.lang-btn{list-style:none;width:34px;height:34px;border:1px solid var(--line);border-radius:50%;background:var(--card);color:var(--muted);display:flex;align-items:center;justify-content:center;cursor:pointer}
.lang-btn::-webkit-details-marker{display:none}
.lang-switch[open] .lang-btn,.lang-btn:hover{color:var(--text);background:var(--soft)}
.lang-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:20;display:flex;flex-direction:column;min-width:132px;padding:6px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.lang-menu a{padding:9px 12px;border-radius:9px;color:var(--text);text-decoration:none;font-size:14px;font-weight:500}
.lang-menu a:hover{background:var(--soft)}
.lang-menu a.on{color:var(--accent);font-weight:600}.lang-menu a.on::after{content:" ✓"}
.wrap{padding:12px 14px 40px;max-width:640px;margin:0 auto}
.card{background:var(--card);border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.hero{background:var(--hero)}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.muted{color:var(--muted);font-size:13px}.nowrap{white-space:nowrap}
input{accent-color:var(--accent)}.center{text-align:center}.warn{color:var(--warn)}
.btn{display:inline-block;border:0;border-radius:10px;padding:9px 14px;font-size:15px;background:var(--soft);color:var(--text);text-decoration:none;cursor:pointer;font-family:inherit;white-space:nowrap}
.btn.p{background:var(--accent);color:#fff}.btn:disabled{opacity:.45;cursor:default}
.link{border:0;background:none;color:var(--muted);font-size:15px;cursor:pointer;font-family:inherit}
.tag{font-family:ui-monospace,Menlo,monospace;font-size:14px}
.pill{display:inline-block;border-radius:99px;padding:2px 9px;font-size:12px;background:var(--okbg);color:var(--ok);white-space:nowrap}
.pill.old{background:var(--warnbg);color:var(--warn)}.pill.bad{background:var(--badbg);color:var(--bad)}
h3{margin:16px 2px 8px;font-size:14px;color:var(--muted);font-weight:600}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:6px}
ul.changes{margin:8px 0 10px;padding-left:18px;font-size:14px}ul.changes li{margin:2px 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}
.chip{display:flex;align-items:center;gap:4px;border-radius:10px;padding:7px 10px;background:var(--soft);font-size:14px;cursor:pointer}
.chip input{margin:0}
.sitev{margin-top:10px}
.deploy{font-size:14px;padding:6px 0;border-top:1px solid var(--line)}.deploy:first-child{border-top:0}
.deploy a{color:inherit;text-decoration:none}
.panel{position:fixed;inset:0;background:var(--bg);z-index:5;display:flex;flex-direction:column}
.panel .top{position:static}
.panel .list{flex:1;overflow:auto;padding:12px 14px}
.opt{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 4px;border-bottom:1px solid var(--line);cursor:pointer}
.opt input{margin-right:8px}.opt.locked{color:var(--muted)}
.panel .foot{padding:12px 14px;padding-bottom:max(12px,env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--line)}
.panel .foot .btn{width:100%}
.back{border:0;background:none;color:var(--accent);font-size:16px;cursor:pointer;padding:0;font-family:inherit}
.rows{padding:2px 14px}
.siterow{display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line);cursor:pointer;min-height:48px}
.siterow:first-child{border-top:0}
.siterow .name{width:112px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.siterow .mid{flex:1;display:flex;align-items:center;gap:6px;min-width:0}
.siterow .lbl{font-size:12px;color:var(--muted);white-space:nowrap;min-width:78px;flex:none;text-align:right}.siterow .lbl.bad{color:var(--bad)}.siterow .lbl.ok{color:var(--ok)}
.siterow .chev{font-size:18px}
.seg{display:flex;gap:3px;flex:1}.seg i{flex:1;height:6px;border-radius:3px;background:var(--line)}
.seg i.d{background:var(--accent)}.seg i.n{background:var(--accent);animation:pulse 1s infinite alternate}
.linkrow{display:flex;justify-content:space-between;align-items:center;width:100%;border:0;font:inherit;color:inherit;text-align:left;cursor:pointer}
.btn.danger{background:var(--bad)}
.sheet{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;z-index:6}
.sheetin{background:var(--card);width:100%;border-radius:16px 16px 0 0;padding:18px 16px;padding-bottom:max(18px,env(safe-area-inset-bottom));box-sizing:border-box}
.sheetin p{margin:10px 0;line-height:1.5}.sheetin .bad{color:var(--bad);font-weight:600}
.confirm{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text)}
.sheetbtns{display:flex;gap:10px;margin-top:14px}.sheetbtns .btn{flex:1}
.optr{display:flex;align-items:center;gap:10px}.notesbtn{border:0;background:none;color:var(--accent);font:inherit;font-size:13px;padding:4px 0;cursor:pointer;white-space:nowrap}
.optnotes{padding:0 4px 10px 28px;border-bottom:1px solid var(--line);font-size:14px}.optnotes ul{margin:0;padding-left:18px}.optnotes li{margin:3px 0;line-height:1.45}.optnotes p{margin:0}
.rel{margin-bottom:10px}.rel a.tag{color:inherit;text-decoration:none;font-weight:600}.rel ul{margin:8px 0 0;padding-left:20px}.rel li{margin:4px 0;line-height:1.45}.rel p{margin:8px 0 0}.relon{font-size:13px;margin-top:4px}
.seg i.f{background:var(--bad)}.seg.bad i.d{opacity:.35}.seg.ok i.d{background:var(--ok)}
@keyframes pulse{from{opacity:.25}to{opacity:.8}}
.ptr{position:fixed;top:max(10px,env(safe-area-inset-top));left:50%;background:var(--card);color:var(--muted);padding:6px 14px;border-radius:99px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:9}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#333;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;z-index:9;max-width:90vw}
.login{text-align:center;padding:28px 14px}
.apply{display:flex;flex-direction:column;gap:12px;margin-top:12px}.apply label{display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--muted)}
.apply input,.apply textarea{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text)}
.user{padding:12px 0;border-top:1px solid var(--line)}.user:first-child{border-top:0}.user .note{margin:6px 0 0;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.user .acts2{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.user .btn{padding:7px 12px;font-size:14px}
.pill.wait{background:var(--warnbg);color:var(--warn)}.pill.no{background:var(--soft);color:var(--muted)}
.badge{display:inline-block;min-width:20px;padding:1px 7px;border-radius:99px;background:var(--accent);color:#fff;font-size:12px;text-align:center;margin-left:6px}
`;

export const APP_JS = `"use strict";
const app = document.getElementById("app");
// 简 / 繁 / English (i18n.ts): the page's lang says which; the texts' Simplified Chinese is the key.
const LANG = ["zh-TW", "en"].includes(document.documentElement.lang) ? document.documentElement.lang : "zh-CN";
const MSG = ${JSON.stringify(MESSAGES)};
const t = (key, vars) => {
  const m = MSG[key];
  const s = LANG === "zh-CN" || !m ? key : LANG === "en" ? m.en : m.tw;
  return s.replace(/\\{(\\w+)\\}/g, (all, k) => (vars && k in vars ? String(vars[k]) : all));
};
const EN = LANG === "en";
const list = (names) => names.join(EN ? ", " : "、");
// Site names end in 羽毛球, which English shows as Badminton.
const full = (name) => EN ? name.replace(/\\s*羽毛球$/, " Badminton") : name;
// The 文A menu closes when tapping elsewhere.
const langMenu = document.querySelector(".lang-switch");
document.addEventListener("pointerdown", (e) => { if (langMenu && langMenu.open && !langMenu.contains(e.target)) langMenu.open = false; });
let data = null, panel = null, pollUntil = 0, timer = 0, chosen = null;
// Keep browser code inside this script: serializing a bundled server function can leak
// build helpers (such as __name) that do not exist in the browser.
const cmpTag = (a, b) => {
  const parts = (t) => [...t.slice(1).split(".").map(Number), 1].slice(0, 4);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
const TAG_RE = new RegExp(${JSON.stringify(TAG.source)});
const isTag = (t) => TAG_RE.test(t || "");

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const when = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return (d.getMonth() + 1) + "/" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
};
const dateOf = (tag) => data.versions.find((v) => v.tag === tag)?.date;
const siteName = (id) => data.sites.find((s) => s.id === id)?.name || id;
function toast(text) {
  const t = h("div", { class: "toast" }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

async function load() {
  clearTimeout(timer);
  try {
    const res = await fetch("/api/state");
    const body = await res.json();
    if (res.status === 401) return location.reload();
    if (!res.ok) throw new Error(body.error || res.status);
    data = body;
    render();
  } catch (err) {
    app.replaceChildren(h("div", { class: "card" }, h("b", {}, t("读取失败")), h("p", { class: "muted" }, String(err.message || err)),
      h("button", { class: "btn", onclick: load }, t("再试一次"))));
  }
  // Also while main is still being tested, so the 发布 button turns on by itself when it passes.
  const busy = data && (data.busy || (data.pendingCount > 0 && data.mainCi === "running"));
  if (busy || Date.now() < pollUntil) timer = setTimeout(load, data && data.progress ? 15000 : 30000);
}

async function send(sites, tag) {
  const names = sites.length === data.sites.length ? t("全部 {n} 个站点", { n: sites.length }) : list(sites.map((id) => full(siteName(id))));
  const what = tag ? t("把 {tag} 发布到：{names}？", { tag, names }) : t("从 main 打新版本 {tag} 并发布到：{names}？", { tag: data.next, names });
  if (!confirm(what + "\\n\\n" + t("每个站点发布前都会先备份数据库，约 3–5 分钟完成。"))) return false;
  const res = await fetch("/api/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sites, tag, main: tag ? undefined : data.main }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { toast(body.error || t("没能开始发布")); if (body.moved) load(); return false; }
  toast(t("已开始发布，下面「最近的部署」会显示进度"));
  pollUntil = Date.now() + 10 * 60000;
  clearTimeout(timer);
  timer = setTimeout(load, 8000);
  return true;
}

// Viewers see everything but change nothing; the server refuses them anyway.
const canRelease = () => data.me && (data.me.role === "owner" || data.me.role === "engineer");
const readOnly = () => h("div", { class: "muted" }, t("你是只读用户：可以查看，发布、回滚和恢复只有发布工程师可以做。"));

function heroCard() {
  if (!data.pendingCount) {
    return h("div", { class: "card" }, h("b", {}, t("没有新改动")),
      h("div", { class: "muted" }, t("main 上的改动都已经在 {tag} 里了", { tag: data.latest || t("最新版本") })));
  }
  const ci = { success: t("测试站已通过"), running: t("测试站还在测试"), failure: t("测试没通过，先别发布"), none: t("还没有测试结果") }[data.mainCi] || data.mainCi;
  // The ticks survive the page refreshing itself while a deploy runs.
  if (!chosen) chosen = new Set(data.sites.map((s) => s.id));
  const button = h("button", { class: "btn p", disabled: !chosen.size || data.mainCi !== "success" }, t("发布 {tag}", { tag: data.next }));
  button.addEventListener("click", async () => {
    if (!chosen.size) return toast(t("请至少选一个站点"));
    button.disabled = true;
    if (!(await send(data.sites.map((s) => s.id).filter((id) => chosen.has(id)), null))) button.disabled = false;
  });
  const chips = data.sites.map((s) => {
    const box = h("input", { type: "checkbox", checked: chosen.has(s.id) });
    box.addEventListener("change", () => { box.checked ? chosen.add(s.id) : chosen.delete(s.id); button.disabled = !chosen.size || data.mainCi !== "success"; });
    return h("label", { class: "chip" }, box, h("span", { class: "dot", style: "background:" + s.color + ";margin:0 0 0 2px" }), short(s.name));
  });
  const more = data.pendingCount > data.pending.length ? h("li", { class: "muted" }, t("还有 {n} 个", { n: data.pendingCount - data.pending.length })) : null;
  if (!canRelease())
    return h("div", { class: "card hero" },
      h("b", {}, t("新版本可以发布")),
      h("div", { class: "muted" }, t("main 比 {tag} 多 {n} 个改动", { tag: data.latest || t("上个版本"), n: data.pendingCount }) + " · " + ci),
      h("ul", { class: "changes" }, data.pending.map((c) => h("li", {}, c)), more),
      readOnly());
  return h("div", { class: "card hero" },
    h("b", {}, t("新版本可以发布")),
    h("div", { class: "muted" }, t("main 比 {tag} 多 {n} 个改动", { tag: data.latest || t("上个版本"), n: data.pendingCount }) + " · " + ci),
    h("ul", { class: "changes" }, data.pending.map((c) => h("li", {}, c)), more),
    h("div", { class: "muted" }, t("发布到：")),
    h("div", { class: "chips" }, chips),
    h("div", { class: "row", style: "justify-content:flex-end" }, button));
}

const short = (name) => name.replace(/\\s*羽毛球$/, "");
const STEPS = ["测试", "备份", "迁移", "部署", "检查"].map((s) => t(s));
const live = (id) => data.progress && data.progress.sites[id];

function seg(p) {
  const cls = "seg" + (p.failed ? " bad" : p.done >= 5 ? " ok" : "");
  return h("span", { class: cls, title: STEPS.join(" → ") }, STEPS.map((_, i) =>
    h("i", { class: p.failed && i === Math.min(p.done, 4) ? "f" : i < p.done ? "d" : i === p.done ? "n" : "" })));
}

// One line per site (option C): its version and state, or, while it is being released, a lock and the
// five steps. Tapping it opens the version list.
function siteRow(s) {
  const p = live(s.id);
  const middle = p
    ? h("span", { class: "mid" }, h("span", { class: "lock" }, "🔒"), seg(p))
    : h("span", { class: "mid tag" }, s.version || t("版本未知"));
  const right = p
    ? h("span", { class: "lbl" + (p.failed ? " bad" : p.done >= 5 ? " ok" : "") }, t(p.label))
    : !s.ok ? h("span", { class: "pill bad" }, t("打不开"))
    : s.behind > 0 ? h("span", { class: "pill old" }, t("落后 {n}", { n: s.behind }))
    : !s.version ? h("span", { class: "muted" }, t("下次发布后显示"))
    : h("span", { class: "pill" }, t("正常"));
  return h("div", { class: "siterow", onclick: () => (p && !p.failed && p.done < 5 ? toast(t("{name} 正在发布，完成后再换版本", { name: short(s.name) })) : openPanel(s)) },
    h("span", { class: "name" }, h("span", { class: "dot", style: "background:" + s.color }), short(s.name)),
    middle, right, p ? null : h("span", { class: "muted chev" }, "›"));
}

function progressCard() {
  const p = data.progress;
  const n = Object.keys(p.sites).length;
  const elapsed = h("span", {}, "");
  const tick = () => {
    const sec = Math.max(0, Math.round((Date.now() - new Date(p.at)) / 1000));
    elapsed.textContent = t("已用 {m} 分 {s} 秒", { m: Math.floor(sec / 60), s: sec % 60 });
  };
  tick();
  clearInterval(window.__tick);
  window.__tick = setInterval(tick, 1000);
  return h("div", { class: "card hero" },
    h("div", { class: "row" }, h("b", {}, p.restoring ? t("正在恢复数据库") : p.tag ? t("正在发布 {tag}", { tag: p.tag }) : t("正在准备发布")),
      h("a", { class: "muted", href: p.url, target: "_blank", rel: "noopener" }, t("详情 ›"))),
    h("div", { class: "muted" }, (n ? t("{n} 个站点", { n }) + " · " : ""), elapsed, " · " + (p.restoring ? t("先备份、恢复，再换版本，一般 8 分钟左右") : t("一般 5 分钟左右"))),
    h("div", { class: "muted", style: "margin-top:6px" }, STEPS.join(" → ")));
}

function deploysCard() {
  if (!data.deploys.length) return h("div", { class: "card muted" }, t("还没有记录"));
  // One version sent to more sites later (补发) is one line: back-to-back runs of the same tag merge.
  const merged = [];
  for (const d of data.deploys) {
    const last = merged[merged.length - 1];
    if (d.tag && last && last.tag === d.tag) {
      const seen = new Set(last.sites.map((j) => j.id));
      last.sites = [...last.sites, ...d.sites.filter((j) => !seen.has(j.id))];
      last.running = last.running || d.running;
      last.ok = last.ok && d.ok;
    } else merged.push({ ...d, sites: [...d.sites] });
  }
  const order = (j) => data.sites.findIndex((s) => s.id === j.id);
  for (const d of merged) d.sites.sort((x, y) => order(x) - order(y));
  return h("div", { class: "card" }, merged.map((d) => {
    const mark = d.running ? "⏳" : d.ok ? "✓" : "✗";
    if (!d.tag) return h("div", { class: "deploy" }, h("a", { href: d.url, target: "_blank", rel: "noopener" },
      h("div", { class: "row" }, h("span", { class: "warn" }, t("✗ 发布没开始，点开看原因")), h("span", { class: "muted nowrap" }, when(d.at)))));
    // When a site failed or is still going, each site says how it went.
    const one = (j) => short(siteName(j.id));
    const mixed = d.sites.some((j) => j.conclusion !== "success");
    const names = !d.sites.length ? (d.running ? t("准备中") : t("没有部署"))
      : mixed ? list(d.sites.map((j) => one(j) + (j.conclusion === "success" ? " ✓" : j.status !== "completed" ? " ⏳" : " ✗")))
      : d.sites.length === data.sites.length ? t("全部") : list(d.sites.map(one));
    return h("div", { class: "deploy" }, h("a", { href: d.url, target: "_blank", rel: "noopener" },
      h("div", { class: "row" }, h("span", {}, mark + " ", h("span", { class: "tag" }, d.tag), " → " + names), h("span", { class: "muted nowrap" }, when(d.at)))));
  }));
}

function openPanel(s) {
  let pick = null, restoreFirst = false;
  const go = h("button", { class: "btn p", disabled: true }, t("选一个版本"));
  go.addEventListener("click", async () => {
    if (restoreFirst) return openRestore(s, pick);
    go.disabled = true;
    if (await send([s.id], pick)) closePanel(); else go.disabled = false;
  });
  const rows = data.versions.map((v) => {
    const current = v.tag === s.version;
    const locked = !s.movable.includes(v.tag);
    const newer = isTag(s.version) && cmpTag(v.tag, s.version) > 0;
    const label = current ? h("span", { class: "muted" }, t("当前"))
      : !v.perSite ? h("span", { class: "muted" }, t("太旧，不能在这里换"))
      : locked ? h("span", { class: "muted nowrap" }, t("需恢复 🔒"))
      : newer || !isTag(s.version) ? h("span", { class: "pill" }, v.tag === data.latest ? t("最新") : t("较新"))
      : h("span", { class: "muted" }, t("回滚"));
    // A locked version can still be chosen: it needs the database restored first (恢复备份).
    const radio = h("input", { type: "radio", name: "v", disabled: current || !v.perSite || !canRelease() });
    radio.addEventListener("change", () => {
      pick = v.tag;
      restoreFirst = locked;
      go.disabled = false;
      go.className = "btn p" + (locked ? " danger" : "");
      go.textContent = locked ? t("恢复备份并换到 {tag}", { tag: v.tag }) : t("换到 {tag}", { tag: v.tag });
    });
    // 说明 opens this version's release notes under the row, without choosing it.
    const box = h("div", { class: "optnotes", hidden: true });
    const more = h("button", { class: "notesbtn", type: "button" }, t("说明") + " ⌄");
    more.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.hidden = !box.hidden;
      more.textContent = t("说明") + (box.hidden ? " ⌄" : " ⌃");
      if (box.hidden || box.childElementCount) return;
      box.append(h("p", { class: "muted notes" }, t("读取中…")));
      try {
        const r = await releaseNotes(v.tag);
        box.replaceChildren(r ? notesOf(r) : h("p", { class: "muted notes" }, t("没有找到这一版的说明")));
      } catch {
        box.replaceChildren();
        box.hidden = true;
        more.textContent = t("说明") + " ⌄";
        toast(t("没读到说明，请再点一次"));
      }
    });
    return h("div", {},
      h("label", { class: "opt" + (locked ? " locked" : "") },
        h("span", {}, radio, h("span", { class: "tag" }, v.tag), h("span", { class: "muted" }, "  " + when(v.date))),
        h("span", { class: "optr" }, more, label)),
      box);
  });
  panel = h("div", { class: "panel" },
    h("header", { class: "top" }, h("button", { class: "back", onclick: closePanel }, t("‹ 返回")), h("b", {}, full(s.name)), h("span", { style: "width:40px" })),
    h("div", { class: "list" },
      h("p", { class: "muted", style: "margin:0 0 6px" }, [t(s.ok ? "{domain}。" : "{domain}（现在打不开）。", { domain: s.domain }), s.version ? t("现在是 {tag}。", { tag: s.version }) : null,
        t("换版本前会自动备份这个站点的数据库。回滚到更早的版本，如果数据库已经有它不认识的改动，会被自动拒绝。")].filter(Boolean).join(EN ? " " : "")),
      rows),
    h("div", { class: "foot" }, canRelease() ? go : readOnly()));
  document.body.append(panel);
  history.pushState({ panel: true }, "");
}
// A release's notes as a list, each line with its PR number linked.
function notesOf(r) {
  const pr = (n) => h("a", { href: r.url.split("/releases/")[0] + "/pull/" + n, target: "_blank", rel: "noopener", class: "muted" }, " #" + n);
  return r.notes.length ? h("ul", { class: "notes" }, r.notes.map((n) => h("li", {}, n.text, n.pr ? pr(n.pr) : null)))
    : h("p", { class: "muted notes" }, t("没有说明"));
}
// The newest 20 releases with their notes, read once when a site's version list first needs them.
let recentNotes = null;
function releaseNotes(tag) {
  recentNotes = recentNotes || fetch("/api/releases?page=1").then((res) => res.ok ? res.json() : Promise.reject(new Error(res.status)));
  recentNotes.catch(() => { recentNotes = null; });
  return recentNotes.then((b) => b.releases.find((r) => r.tag === tag));
}

// 恢复备份并换版本: says what will be lost and wants the site's id typed before it starts.
function openRestore(s, tag) {
  const want = data.versions.find((v) => v.tag === tag);
  // The database goes back to before the first newer migration ran on this site, which happened when
  // the oldest version carrying it was first deployed there: not before that version came out.
  const from = data.versions.filter((v) => v.migration && want && want.migration && v.migration > want.migration)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const input = h("input", { class: "confirm", autocapitalize: "off", autocomplete: "off", spellcheck: "false", placeholder: s.id });
  const ok = h("button", { class: "btn p danger", disabled: true }, t("恢复并换到 {tag}", { tag }));
  input.addEventListener("input", () => { ok.disabled = input.value.trim().toLowerCase() !== s.id; });
  const box = h("div", { class: "sheet" },
    h("div", { class: "sheetin" },
      h("b", {}, t("恢复 {name} 的数据库", { name: short(s.name) })),
      h("p", {}, t("数据库会回到它第一次执行 {tag} 不认识的数据库改动之前{when}，然后换到 {tag}。", { tag, when: from ? t("（不早于 {date}，{from} 发布的时间）", { date: when(from.date), from: from.tag }) : "" })),
      h("p", { class: "bad" }, t("这之后这个站点上的报名、付款、设置改动都会丢失。")),
      h("p", { class: "muted" }, t("恢复前会先把现在的数据库备份一份（保存 90 天），万一需要还能找回。只能恢复到 30 天以内。其他站点不受影响。")),
      h("p", {}, ...t("请输入 {id} 确认：").split("{id}").flatMap((part, i) => i ? [h("b", {}, s.id), part] : [part])),
      input,
      h("div", { class: "sheetbtns" }, h("button", { class: "btn", onclick: () => box.remove() }, t("取消")), ok)));
  ok.addEventListener("click", async () => {
    ok.disabled = true;
    const res = await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site: s.id, tag, confirm: input.value.trim().toLowerCase() }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast(body.error || t("没能开始恢复")); ok.disabled = false; return; }
    box.remove();
    closePanel();
    toast(t("已开始恢复，完成后会自动换到 {tag}", { tag }));
    pollUntil = Date.now() + 15 * 60000;
    clearTimeout(timer);
    setTimeout(load, 3000);
  });
  panel.append(box);
  input.focus();
}

// Every published version with its notes, newest first, 20 at a time.
function openReleases() {
  const list = h("div", { class: "list" });
  const more = h("button", { class: "btn", style: "width:100%;margin-top:4px" }, t("加载更多"));
  let page = 0;
  const one = (r) => {
    const on = data.sites.filter((s) => s.version === r.tag).map((s) => short(s.name));
    return h("div", { class: "card rel" },
      h("div", { class: "row" },
        h("span", {}, h("a", { href: r.url, target: "_blank", rel: "noopener", class: "tag" }, r.tag), r.tag === data.latest ? h("span", { class: "pill", style: "margin-left:8px" }, t("最新")) : null),
        h("span", { class: "muted nowrap" }, when(r.date))),
      on.length ? h("div", { class: "muted relon" }, t("在用：{names}", { names: list(on) })) : null,
      notesOf(r));
  };
  const next = async () => {
    more.disabled = true;
    more.textContent = t("读取中…");
    try {
      const res = await fetch("/api/releases?page=" + (page + 1));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.status);
      page++;
      list.append(...body.releases.map(one));
      more.hidden = !body.more;
      more.textContent = t("加载更多");
    } catch (err) {
      more.textContent = t("没读到，点这里重试（{msg}）", { msg: err.message });
    }
    more.disabled = false;
  };
  more.addEventListener("click", next);
  panel = h("div", { class: "panel" },
    h("header", { class: "top" }, h("button", { class: "back", onclick: closePanel }, t("‹ 返回")), h("b", {}, t("所有版本")), h("span", { style: "width:40px" })),
    h("div", { class: "list" }, list, more));
  document.body.append(panel);
  history.pushState({ panel: true }, "");
  next();
}
// 用户和权限 (the owner only): applications to approve, and who is a viewer or a release engineer.
const STATUS = { pending: ["等批准", "wait"], engineer: ["发布工程师", ""], viewer: ["只读", "old"], rejected: ["没有权限", "no"] };
const ACTIONS = {
  pending: [["viewer", "批准（只读）", ""], ["engineer", "批准为发布工程师", "p"], ["rejected", "拒绝", ""]],
  viewer: [["engineer", "设为发布工程师", "p"], ["rejected", "取消权限", ""]],
  engineer: [["viewer", "改为只读", ""], ["rejected", "取消权限", ""]],
  rejected: [["viewer", "批准（只读）", ""], ["remove", "删除（可以重新申请）", ""]],
};
function openUsers() {
  const list = h("div", { class: "card rows" }, h("p", { class: "muted" }, t("读取中…")));
  const draw = (users) => {
    data.waiting = users.filter((u) => u.status === "pending").length;
    if (!users.length) return list.replaceChildren(h("p", { class: "muted" }, t("还没有人申请")));
    list.replaceChildren(...users.map((u) => {
      const [name, cls] = STATUS[u.status];
      const buttons = ACTIONS[u.status].map(([action, text, p]) => {
        const b = h("button", { class: "btn" + (p ? " p" : "") }, t(text));
        b.addEventListener("click", async () => {
          b.disabled = true;
          const res = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: u.email, action }) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) { b.disabled = false; return toast(body.error || t("没能保存")); }
          draw(body.users);
        });
        return b;
      });
      return h("div", { class: "user" },
        h("div", { class: "row" }, h("b", {}, u.name || u.email), h("span", { class: "pill " + cls }, t(name))),
        h("div", { class: "muted" }, u.email + " · " + t("申请于 {when}", { when: when(u.appliedAt) })),
        u.note ? h("p", { class: "note" }, u.note) : null,
        h("div", { class: "acts2" }, buttons));
    }));
  };
  panel = h("div", { class: "panel" },
    h("header", { class: "top" }, h("button", { class: "back", onclick: () => { closePanel(); render(); } }, t("‹ 返回")), h("b", {}, t("用户和权限")), h("span", { style: "width:40px" })),
    h("div", { class: "list" },
      h("p", { class: "muted", style: "margin:0 0 10px" }, t("只读用户可以看这个页面；发布工程师还可以发布、回滚和恢复。取消权限后对方立刻不能再用。")),
      list));
  document.body.append(panel);
  history.pushState({ panel: true }, "");
  fetch("/api/users").then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.status);
    draw(body.users);
  }).catch((err) => list.replaceChildren(h("p", { class: "warn" }, t("读取失败") + "：" + (err.message || err))));
}
function closePanel() {
  if (!panel) return;
  panel.remove();
  panel = null;
  if (history.state && history.state.panel) history.back();
}
addEventListener("popstate", () => { if (panel) { panel.remove(); panel = null; if (data) render(); } });

function render() {
  if (!data.progress) clearInterval(window.__tick);
  const users = data.me && data.me.role === "owner"
    ? h("button", { class: "card linkrow", onclick: openUsers }, h("span", {}, t("用户和权限"), data.waiting ? h("span", { class: "badge" }, t("{n} 个申请", { n: data.waiting })) : null), h("span", { class: "muted chev" }, "›"))
    : null;
  app.replaceChildren(...[data.progress ? progressCard() : heroCard(),
    h("button", { class: "card linkrow", onclick: openReleases }, h("span", {}, t("所有版本和发布说明")), h("span", { class: "muted chev" }, "›")),
    users,
    h("h3", {}, t("各站点")),
    h("div", { class: "card rows" }, data.sites.map(siteRow)), h("h3", {}, t("最近的部署")), deploysCard()].filter(Boolean));
}
load();

// 下拉刷新 for the page added to the home screen, which has no reload button of its own. In a browser
// tab the browser's own pull-to-refresh does this.
if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
  const PULL = 70;
  let startY = null, dy = 0;
  const tip = h("div", { class: "ptr", role: "status" });
  const show = () => {
    if (dy < 12) return tip.remove();
    tip.textContent = dy >= PULL ? t("松开刷新") : t("下拉刷新");
    tip.style.transform = "translate(-50%," + Math.min(dy - PULL, 0) + "px)";
    if (!tip.isConnected) document.body.append(tip);
  };
  addEventListener("touchstart", (e) => {
    // A panel scrolls on its own; pulling it down is not a refresh.
    startY = !panel && scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (startY === null) return;
    dy = scrollY <= 0 ? Math.max(0, Math.min(e.touches[0].clientY - startY, PULL * 1.6)) : 0;
    show();
  }, { passive: true });
  const end = () => {
    if (startY !== null && dy >= PULL) { tip.textContent = t("刷新中…"); tip.style.transform = "translate(-50%,0)"; location.reload(); return; }
    startY = null; dy = 0; tip.remove();
  };
  addEventListener("touchend", end);
  addEventListener("touchcancel", end);
}
`;
