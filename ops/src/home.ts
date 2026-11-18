// The 总入口's own pages (hub.ts): the home page with the groups and coming events of whoever is
// signed in, and 开发者设置, where 站点管理 (the Release Service) now lives. Drawn by the server, no
// script: everything a site said is escaped, and links go only to the known sites' own addresses.
import type { Group, HubEvent } from "./hub";
import { type Lang, tr } from "./i18n";
import { esc, shell } from "./page";
import type { Role } from "./users";

// Each group in the colour of its site's icon: a class, since the content policy allows no inline styles.
const TONES: Record<string, string> = {
  "#3d7bd9": "t-ocean",
  "#3aa564": "t-forest",
  "#9b7fa8": "t-grape",
  "#8a63d2": "t-violet",
};
const tone = (color: string) => TONES[color] ?? "t-coral";
const dot = `<i class="gdot"></i>`;

/** 周三, Wed: the event's own day, whatever the reader's time zone. */
function weekday(lang: Lang, date: string): string {
  return new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
/** Site names end in 羽毛球, which English shows as Badminton (as on the Release Service). */
const named = (lang: Lang, name: string) => (lang === "en" ? name.replace(/\s*羽毛球$/, " Badminton") : name);
/** The 总入口's name, the same in every language (Ke Li 2026-11-18: an English name, short like Keep). */
export const HUB_NAME = "Rally";

const ROLES: Record<string, string> = { owner: "群主", admin: "管理员", organizer: "组织者" };

export function homePage(o: {
  lang: Lang;
  email: string | null;
  role: Role | null;
  groups: Group[];
  problem: string | null;
  error: string | null;
}): string {
  const t = (key: string, vars?: Record<string, string | number>) => tr(o.lang, key, vars);
  const title = HUB_NAME;
  if (o.problem)
    return shell({
      lang: o.lang,
      title,
      email: null,
      body: `<div class="card"><b>${t("还不能用")}</b><p class="muted">${esc(o.problem)}</p></div>`,
    });
  if (!o.email)
    return shell({
      lang: o.lang,
      title,
      email: null,
      body: `<div class="card login"><p>${t("用 Google 登录，查看你加入的羽毛球群和近期活动。")}</p>${
        o.error ? `<p class="warn">${t("登录没有完成，请再试一次。")}</p>` : ""
      }<a class="btn p" href="/login">${t("用 Google 登录")}</a></div>`,
    });

  const events = o.groups
    .flatMap((g) => g.events.map((e) => ({ g, e })))
    .sort((a, b) => (a.e.date + a.e.startTime).localeCompare(b.e.date + b.e.startTime));
  // The groups' sites' event card: the date large on the group's colour, 报名 / 查看 in the corner.
  const card = ({ g, e }: { g: Group; e: HubEvent }) => {
    const [, month, date] = e.date.split("-").map(Number);
    const status = e.signedUp
      ? `<span class="status mine"><i></i>${t("我已报名")}</span>`
      : e.status === "open"
        ? `<span class="status"><i></i>${t("报名中")}</span>`
        : `<span class="status shut"><i></i>${t("报名已截止")}</span>`;
    return `<a class="card ev ${tone(g.site.color)}" href="https://${g.site.domain}/e/${encodeURIComponent(e.code)}">
<div class="evhead"><div class="evtop">${status}</div>
<span class="evdate">${month}/${date}<small>${esc(weekday(o.lang, e.date))} ${e.startTime}–${e.endTime}</small></span>
<span class="evwhat">${esc(e.title || e.location)}${e.title && e.location ? `<small> · ${esc(e.location)}</small>` : ""}</span>
<span class="evcta">${e.signedUp || e.status !== "open" ? t("查看") : t("报名")}</span></div>
<div class="evfoot"><span class="grp">${dot}${esc(named(o.lang, g.name))}</span><span>${t("{n} 人", { n: e.headcount })}</span></div></a>`;
  };
  const group = (g: Group) => {
    const home = `https://${g.site.domain}`;
    const m = g.member;
    const bits = [esc(m.name), ROLES[m.role] ? t(ROLES[m.role]!) : ""].filter(Boolean).join(" · ");
    const pills = m.pending
      ? `<span class="pill wait">${t("等待审核")}</span>`
      : m.unpaidCents
        ? `<span class="pill old">${t("待付 ${amount}", { amount: (m.unpaidCents / 100).toFixed(2) })}</span>`
        : "";
    const manage = ROLES[m.role] ? `<a class="btn" href="${home}/admin/google">${t("管理")}</a>` : "";
    return `<div class="group ${tone(g.site.color)}">${dot}<a class="who" href="${home}/me"><b>${esc(named(o.lang, g.name))}</b><span class="muted">${bits}</span></a>${pills}${manage}</div>`;
  };
  const body = o.groups.length
    ? `<h3>${t("近期活动")}</h3>${
        events.length ? events.map(card).join("") : `<div class="card muted center">${t("最近没有活动。")}</div>`
      }<h3>${t("我的群")}</h3><div class="card rows">${o.groups.map(group).join("")}</div>`
    : `<div class="card login"><b>${t("还没有找到你加入的群")}</b><p class="muted">${esc(
        t("用这个 Google 账号（{email}）在群自己的网站上加入后，群和活动就会出现在这里。", { email: o.email }),
      )}</p></div>`;
  return shell({
    lang: o.lang,
    title,
    email: o.email,
    body,
    extra: o.role ? `<a class="devlink" href="/dev">${t("开发者设置")}</a>` : "",
  });
}

/** 开发者设置: the advanced tools. Today only 站点管理; whoever isn't approved can apply from there. */
export function devPage(o: { lang: Lang; email: string }): string {
  const t = (key: string) => tr(o.lang, key);
  return shell({
    lang: o.lang,
    title: t("开发者设置"),
    email: o.email,
    back: { href: "/", label: t("首页") },
    body: `<a class="card menu" href="/dev/release"><span><b>${t("站点管理")}</b><span class="muted">${t(
      "各站点的版本、发布、回滚和恢复（Release Service）",
    )}</span></span><span class="muted">›</span></a>`,
  });
}
