import { TAG } from "./logic";

// The release site's page: a shell, its stylesheet and its script (no inline code, so the content policy
// allows only this site's own files). The script draws everything from /api/state.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ERRORS: Record<string, string> = {
  login: "登录没有完成，请再试一次。",
  account: "这个 Google 账号不能管理发布。",
};

export function page({
  email,
  problem,
  error,
}: {
  email: string | null;
  problem: string | null;
  error: string | null;
}) {
  const top = email
    ? `<form method="post" action="/logout"><button class="link" title="${esc(email)}">退出</button></form>`
    : "";
  let body: string;
  if (problem) body = `<div class="card"><b>还不能用</b><p class="muted">${esc(problem)}</p></div>`;
  else if (!email)
    body = `<div class="card login"><p>只有管理员的 Google 账号可以登录。</p>${
      error && ERRORS[error] ? `<p class="warn">${ERRORS[error]}</p>` : ""
    }<a class="btn p" href="/login">用 Google 登录</a></div>`;
  else body = `<div id="app"><p class="muted center">正在读取…</p></div><script src="/app.js"></script>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>站点发布管理</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23e8664f'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/app.css"></head><body>
<header class="top"><b>站点发布管理</b>${top}</header><main class="wrap">${body}</main></body></html>`;
}

export const APP_CSS = `
:root{--bg:#f4f2ef;--card:#fff;--text:#222;--muted:#888;--line:#eee;--soft:#f0ece7;--accent:#e8664f;--hero:#fff7f4;--ok:#2e8b57;--okbg:#eaf6ee;--warn:#c77700;--warnbg:#fff4e0;--bad:#c0392b;--badbg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--card:#1f1f1f;--text:#eee;--muted:#999;--line:#2c2c2c;--soft:#2b2b2b;--hero:#2a1f1c;--ok:#5cc489;--okbg:#18301f;--warn:#e0a040;--warnbg:#33270f;--bad:#ef7b6e;--badbg:#3a1c19}}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,"PingFang SC","Noto Sans CJK SC",system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:15px;-webkit-text-size-adjust:100%}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;padding-top:max(14px,env(safe-area-inset-top));background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
.top b{font-size:17px}
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
.opt input{margin-right:8px}.opt.locked{color:var(--muted);cursor:default}
.panel .foot{padding:12px 14px;padding-bottom:max(12px,env(safe-area-inset-bottom));background:var(--card);border-top:1px solid var(--line)}
.panel .foot .btn{width:100%}
.back{border:0;background:none;color:var(--accent);font-size:16px;cursor:pointer;padding:0;font-family:inherit}
.rows{padding:2px 14px}
.siterow{display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line);cursor:pointer;min-height:48px}
.siterow:first-child{border-top:0}
.siterow .name{width:112px;flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.siterow .mid{flex:1;display:flex;align-items:center;gap:6px;min-width:0}
.siterow .lbl{font-size:12px;color:var(--muted);white-space:nowrap;width:78px;flex:none;text-align:right}.siterow .lbl.bad{color:var(--bad)}.siterow .lbl.ok{color:var(--ok)}
.siterow .chev{font-size:18px}
.seg{display:flex;gap:3px;flex:1}.seg i{flex:1;height:6px;border-radius:3px;background:var(--line)}
.seg i.d{background:var(--accent)}.seg i.n{background:var(--accent);animation:pulse 1s infinite alternate}
.linkrow{display:flex;justify-content:space-between;align-items:center;width:100%;margin-top:12px;border:0;font:inherit;color:inherit;text-align:left;cursor:pointer}
.rel{margin-bottom:10px}.rel a.tag{color:inherit;text-decoration:none;font-weight:600}.rel ul{margin:8px 0 0;padding-left:20px}.rel li{margin:4px 0;line-height:1.45}.rel p{margin:8px 0 0}.relon{font-size:13px;margin-top:4px}
.seg i.f{background:var(--bad)}.seg.bad i.d{opacity:.35}.seg.ok i.d{background:var(--ok)}
@keyframes pulse{from{opacity:.25}to{opacity:.8}}
.ptr{position:fixed;top:max(10px,env(safe-area-inset-top));left:50%;background:var(--card);color:var(--muted);padding:6px 14px;border-radius:99px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:9}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#333;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;z-index:9;max-width:90vw}
.login{text-align:center;padding:28px 14px}
`;

export const APP_JS = `"use strict";
const app = document.getElementById("app");
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
    app.replaceChildren(h("div", { class: "card" }, h("b", {}, "读取失败"), h("p", { class: "muted" }, String(err.message || err)),
      h("button", { class: "btn", onclick: load }, "再试一次")));
  }
  // Also while main is still being tested, so the 发布 button turns on by itself when it passes.
  const busy = data && (data.busy || (data.pendingCount > 0 && data.mainCi === "running"));
  if (busy || Date.now() < pollUntil) timer = setTimeout(load, data && data.progress ? 15000 : 30000);
}

async function send(sites, tag) {
  const names = sites.length === data.sites.length ? "全部 " + sites.length + " 个站点" : sites.map(siteName).join("、");
  const what = tag ? "把 " + tag : "从 main 打新版本 " + data.next + " 并";
  if (!confirm(what + " 发布到：" + names + "？\\n\\n每个站点发布前都会先备份数据库，约 3–5 分钟完成。")) return false;
  const res = await fetch("/api/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sites, tag, main: tag ? undefined : data.main }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { toast(body.error || "没能开始发布"); if (body.moved) load(); return false; }
  toast("已开始发布，下面「最近的部署」会显示进度");
  pollUntil = Date.now() + 10 * 60000;
  clearTimeout(timer);
  timer = setTimeout(load, 8000);
  return true;
}

function heroCard() {
  if (!data.pendingCount) {
    return h("div", { class: "card" }, h("b", {}, "没有新改动"),
      h("div", { class: "muted" }, "main 上的改动都已经在 " + (data.latest || "最新版本") + " 里了"));
  }
  const ci = { success: "测试站已通过", running: "测试站还在测试", failure: "测试没通过，先别发布", none: "还没有测试结果" }[data.mainCi] || data.mainCi;
  // The ticks survive the page refreshing itself while a deploy runs.
  if (!chosen) chosen = new Set(data.sites.map((s) => s.id));
  const button = h("button", { class: "btn p", disabled: !chosen.size || data.mainCi !== "success" }, "发布 " + data.next);
  button.addEventListener("click", async () => {
    if (!chosen.size) return toast("请至少选一个站点");
    button.disabled = true;
    if (!(await send(data.sites.map((s) => s.id).filter((id) => chosen.has(id)), null))) button.disabled = false;
  });
  const chips = data.sites.map((s) => {
    const box = h("input", { type: "checkbox", checked: chosen.has(s.id) });
    box.addEventListener("change", () => { box.checked ? chosen.add(s.id) : chosen.delete(s.id); button.disabled = !chosen.size || data.mainCi !== "success"; });
    return h("label", { class: "chip" }, box, h("span", { class: "dot", style: "background:" + s.color + ";margin:0 0 0 2px" }), s.name.replace(/\\s*羽毛球$/, ""));
  });
  const more = data.pendingCount > data.pending.length ? h("li", { class: "muted" }, "还有 " + (data.pendingCount - data.pending.length) + " 个") : null;
  return h("div", { class: "card hero" },
    h("b", {}, "新版本可以发布"),
    h("div", { class: "muted" }, "main 比 " + (data.latest || "上个版本") + " 多 " + data.pendingCount + " 个改动 · " + ci),
    h("ul", { class: "changes" }, data.pending.map((c) => h("li", {}, c)), more),
    h("div", { class: "muted" }, "发布到："),
    h("div", { class: "chips" }, chips),
    h("div", { class: "row", style: "justify-content:flex-end" }, button));
}

const short = (name) => name.replace(/\\s*羽毛球$/, "");
const STEPS = ["测试", "备份", "迁移", "部署", "检查"];
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
    : h("span", { class: "mid tag" }, s.version || "版本未知");
  const right = p
    ? h("span", { class: "lbl" + (p.failed ? " bad" : p.done >= 5 ? " ok" : "") }, p.label)
    : !s.ok ? h("span", { class: "pill bad" }, "打不开")
    : s.behind > 0 ? h("span", { class: "pill old" }, "落后 " + s.behind)
    : !s.version ? h("span", { class: "muted" }, "下次发布后显示")
    : h("span", { class: "pill" }, "正常");
  return h("div", { class: "siterow", onclick: () => (p && !p.failed && p.done < 5 ? toast(short(s.name) + " 正在发布，完成后再换版本") : openPanel(s)) },
    h("span", { class: "name" }, h("span", { class: "dot", style: "background:" + s.color }), short(s.name)),
    middle, right, p ? null : h("span", { class: "muted chev" }, "›"));
}

function progressCard() {
  const p = data.progress;
  const n = Object.keys(p.sites).length;
  const elapsed = h("span", {}, "");
  const tick = () => {
    const sec = Math.max(0, Math.round((Date.now() - new Date(p.at)) / 1000));
    elapsed.textContent = "已用 " + Math.floor(sec / 60) + " 分 " + (sec % 60) + " 秒";
  };
  tick();
  clearInterval(window.__tick);
  window.__tick = setInterval(tick, 1000);
  return h("div", { class: "card hero" },
    h("div", { class: "row" }, h("b", {}, p.tag ? "正在发布 " + p.tag : "正在准备发布"),
      h("a", { class: "muted", href: p.url, target: "_blank", rel: "noopener" }, "详情 ›")),
    h("div", { class: "muted" }, (n ? n + " 个站点 · " : ""), elapsed, " · 一般 5 分钟左右"),
    h("div", { class: "muted", style: "margin-top:6px" }, STEPS.join(" → ")));
}

function deploysCard() {
  if (!data.deploys.length) return h("div", { class: "card muted" }, "还没有记录");
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
      h("div", { class: "row" }, h("span", { class: "warn" }, "✗ 发布没开始，点开看原因"), h("span", { class: "muted nowrap" }, when(d.at)))));
    // When a site failed or is still going, each site says how it went.
    const one = (j) => siteName(j.id).replace(/\\s*羽毛球$/, "");
    const mixed = d.sites.some((j) => j.conclusion !== "success");
    const names = !d.sites.length ? (d.running ? "准备中" : "没有部署")
      : mixed ? d.sites.map((j) => one(j) + (j.conclusion === "success" ? " ✓" : j.status !== "completed" ? " ⏳" : " ✗")).join("、")
      : d.sites.length === data.sites.length ? "全部" : d.sites.map(one).join("、");
    return h("div", { class: "deploy" }, h("a", { href: d.url, target: "_blank", rel: "noopener" },
      h("div", { class: "row" }, h("span", {}, mark + " ", h("span", { class: "tag" }, d.tag), " → " + names), h("span", { class: "muted nowrap" }, when(d.at)))));
  }));
}

function openPanel(s) {
  let pick = null;
  const go = h("button", { class: "btn p", disabled: true }, "选一个版本");
  go.addEventListener("click", async () => { go.disabled = true; if (await send([s.id], pick)) closePanel(); else go.disabled = false; });
  const rows = data.versions.map((v) => {
    const current = v.tag === s.version;
    const locked = !s.movable.includes(v.tag);
    const newer = isTag(s.version) && cmpTag(v.tag, s.version) > 0;
    const label = current ? h("span", { class: "muted" }, "当前")
      : !v.perSite ? h("span", { class: "muted" }, "太旧，不能在这里换")
      : locked ? h("span", { class: "muted" }, "要先恢复备份 🔒")
      : newer || !isTag(s.version) ? h("span", { class: "pill" }, v.tag === data.latest ? "最新" : "较新")
      : h("span", { class: "muted" }, "回滚");
    const radio = h("input", { type: "radio", name: "v", disabled: current || locked });
    radio.addEventListener("change", () => { pick = v.tag; go.disabled = false; go.textContent = "换到 " + v.tag; });
    return h("label", { class: "opt" + (locked ? " locked" : "") }, h("span", {}, radio, h("span", { class: "tag" }, v.tag), h("span", { class: "muted" }, "  " + when(v.date))), label);
  });
  panel = h("div", { class: "panel" },
    h("header", { class: "top" }, h("button", { class: "back", onclick: closePanel }, "‹ 返回"), h("b", {}, s.name), h("span", { style: "width:40px" })),
    h("div", { class: "list" },
      h("p", { class: "muted", style: "margin:0 0 6px" }, s.domain + (s.ok ? "" : "（现在打不开）") + "。" + (s.version ? "现在是 " + s.version + "。" : "") + "换版本前会自动备份这个站点的数据库。回滚到更早的版本，如果数据库已经有它不认识的改动，会被自动拒绝。"),
      rows),
    h("div", { class: "foot" }, go));
  document.body.append(panel);
  history.pushState({ panel: true }, "");
}
// Every published version with its notes, newest first, 20 at a time.
function openReleases() {
  const list = h("div", { class: "list" });
  const more = h("button", { class: "btn", style: "width:100%;margin-top:4px" }, "加载更多");
  let page = 0;
  const one = (r) => {
    const on = data.sites.filter((s) => s.version === r.tag).map((s) => short(s.name));
    const pr = (n) => h("a", { href: r.url.split("/releases/")[0] + "/pull/" + n, target: "_blank", rel: "noopener", class: "muted" }, " #" + n);
    return h("div", { class: "card rel" },
      h("div", { class: "row" },
        h("span", {}, h("a", { href: r.url, target: "_blank", rel: "noopener", class: "tag" }, r.tag), r.tag === data.latest ? h("span", { class: "pill", style: "margin-left:8px" }, "最新") : null),
        h("span", { class: "muted nowrap" }, when(r.date))),
      on.length ? h("div", { class: "muted relon" }, "在用：" + on.join("、")) : null,
      r.notes.length ? h("ul", {}, r.notes.map((n) => h("li", {}, n.text, n.pr ? pr(n.pr) : null)))
        : h("p", { class: "muted" }, "没有说明"));
  };
  const next = async () => {
    more.disabled = true;
    more.textContent = "读取中…";
    try {
      const res = await fetch("/api/releases?page=" + (page + 1));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.status);
      page++;
      list.append(...body.releases.map(one));
      more.hidden = !body.more;
      more.textContent = "加载更多";
    } catch (err) {
      more.textContent = "没读到，点这里重试（" + err.message + "）";
    }
    more.disabled = false;
  };
  more.addEventListener("click", next);
  panel = h("div", { class: "panel" },
    h("header", { class: "top" }, h("button", { class: "back", onclick: closePanel }, "‹ 返回"), h("b", {}, "所有版本"), h("span", { style: "width:40px" })),
    h("div", { class: "list" }, list, more));
  document.body.append(panel);
  history.pushState({ panel: true }, "");
  next();
}
function closePanel() {
  if (!panel) return;
  panel.remove();
  panel = null;
  if (history.state && history.state.panel) history.back();
}
addEventListener("popstate", () => { if (panel) { panel.remove(); panel = null; } });

function render() {
  if (!data.progress) clearInterval(window.__tick);
  app.replaceChildren(data.progress ? progressCard() : heroCard(), h("h3", {}, "各站点"),
    h("div", { class: "card rows" }, data.sites.map(siteRow)), h("h3", {}, "最近的部署"), deploysCard(),
    h("button", { class: "card linkrow", onclick: openReleases }, h("span", {}, "所有版本和发布说明"), h("span", { class: "muted chev" }, "›")));
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
    tip.textContent = dy >= PULL ? "松开刷新" : "下拉刷新";
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
    if (startY !== null && dy >= PULL) { tip.textContent = "刷新中…"; tip.style.transform = "translate(-50%,0)"; location.reload(); return; }
    startY = null; dy = 0; tip.remove();
  };
  addEventListener("touchend", end);
  addEventListener("touchcancel", end);
}
`;
