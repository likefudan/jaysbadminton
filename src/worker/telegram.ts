import { getSettings, now, setSetting } from "./db";
import type { Env } from "./env";
import { HttpError } from "./http";
import { hmac, randomToken, sha256 } from "./lib/crypto";
import { currentAdminToken } from "./auth";
import { ROLE_TITLE, currentStaffSql, eventManager, isStaff, memberRole, organizersEnabled } from "./organizers";

/**
 * One bot (created by whoever hosts the site) talks to one chat per person: the Owner's, kept in
 * `settings` as before, and each organizer's, in their telegram_bindings row. A chat is bound from
 * the admin page with a one-time code carried by a t.me start link, so nobody who merely finds the
 * bot can receive anything. Binding again replaces that person's previous chat.
 */

const BIND_MINUTES = 10;

interface TgResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function call<T>(env: Env, method: string, body: unknown): Promise<TgResult<T>> {
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, description: "bot token not configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return (await res.json()) as TgResult<T>;
  } catch (err) {
    return { ok: false, description: (err as Error).message };
  }
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendTo(env: Env, chatId: string, html: string): Promise<boolean> {
  const r = await call(env, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  if (!r.ok) console.error("telegram send failed:", r.description);
  return r.ok;
}

/** Sends an HTML message to the bound Owner chat. False when not set up or Telegram refused it. */
export async function sendToOwner(env: Env, html: string): Promise<boolean> {
  const { telegram_chat_id: chatId } = await getSettings(env.DB, ["telegram_chat_id"]);
  if (!chatId) return false;
  return sendTo(env, chatId, html);
}

interface Recipient {
  id: string;
  username: string;
  is_owner: number;
  role: string;
  status: string;
  deleted_at: string | null;
  chat_id: string | null;
}

async function recipient(db: D1Database, memberId: string): Promise<Recipient | null> {
  return db
    .prepare(
      `SELECT m.id, m.username, m.is_owner, m.role, m.status, m.deleted_at, t.chat_id
       FROM members m LEFT JOIN telegram_bindings t ON t.member_id = m.id WHERE m.id = ?`,
    )
    .bind(memberId)
    .first<Recipient>();
}

/** Where notify.ts's message() starts the text to paste into WeChat. */
export const WECHAT_BLOCK = "\n\n—— 可复制到微信 ——\n";

/** Where an organizer opens the admin pages: through Google, never the Owner's admin link. */
export const organizerAdminLink = (env: Env) => `${env.SITE_ORIGIN}/admin/google`;

/**
 * Puts the organizer's way into the admin pages under a notice that sends them there (`adminPage`),
 * before the WeChat block.
 */
function withAdminLink(env: Env, html: string, adminPage: boolean): string {
  if (!adminPage) return html;
  const link = `管理页（用 Google 登录）：${escapeHtml(organizerAdminLink(env))}`;
  const cut = html.indexOf(WECHAT_BLOCK);
  return cut < 0 ? `${html}\n\n${link}` : `${html.slice(0, cut)}\n\n${link}${html.slice(cut)}`;
}

/**
 * Sends to one person's own chat: the Owner's, or a current organizer's or admin's (only while the
 * feature is on). False when they have none, are no longer one, or Telegram refused it.
 */
export async function sendToMember(env: Env, memberId: string, html: string): Promise<boolean> {
  const m = await recipient(env.DB, memberId);
  if (!m) return false;
  const role = memberRole(env, m);
  if (role === "owner") return sendToOwner(env, html);
  if (!isStaff(role) || !m.chat_id) return false;
  return sendTo(env, m.chat_id, html);
}

export interface ManagerDelivery {
  ok: boolean;
  /** Whether it went to the Owner: the event is theirs, or it fell back to them. */
  owner: boolean;
  /** The organizer who runs the event, when that is not the Owner. */
  organizer: string | null;
  /** The organizer's chat when it went there. */
  chatId: string | null;
}

/** Sends a follow-up to wherever an earlier sendToManager went, so a run of messages stays together. */
export async function sendLikewise(env: Env, d: ManagerDelivery, html: string): Promise<boolean> {
  return d.owner || !d.chatId ? sendToOwner(env, html) : sendTo(env, d.chatId, html);
}

/**
 * An event's notice goes to whoever runs it (design §7). When that is an organizer who can't get
 * it (no Telegram, no longer an organizer, the feature off, or Telegram refused it), it goes to the
 * Owner instead, opening with why.
 */
export async function sendToManager(
  env: Env,
  e: { manager_id: string | null },
  html: string,
  adminPage = false,
): Promise<ManagerDelivery> {
  return sendToResponsible(env, await eventManager(env.DB, e), html, adminPage, {
    off: (name) => `这场由 ${name} 负责，但组织者功能已关闭`,
    former: (name) => `这场的负责人 ${name} 已经不是组织者或管理员`,
  });
}

/**
 * A notice about money that went into someone's account (待确认, 转发可能中断) goes to that
 * account's owner (design §7): a current organizer, else the Owner, opening with why when it
 * falls back. A 历史收款人's go to the Owner, who handles them now.
 */
export async function sendToPayee(env: Env, payeeId: string | null, html: string): Promise<ManagerDelivery> {
  return sendToResponsible(env, payeeId, html, true, {
    off: (name) => `这条是关于 ${name} 的收款账户的，但组织者功能已关闭`,
    former: (name) => `这条是关于历史收款人 ${name} 的收款账户的（已经不是组织者或管理员）`,
  });
}

async function sendToResponsible(
  env: Env,
  id: string | null,
  html: string,
  adminPage: boolean,
  why_: { off: (name: string) => string; former: (name: string) => string },
): Promise<ManagerDelivery> {
  const m = id ? await recipient(env.DB, id) : null;
  if (!m || m.is_owner === 1) return { ok: await sendToOwner(env, html), owner: true, organizer: null, chatId: null };
  const name = escapeHtml(m.username);
  let why: string;
  const role = memberRole(env, m);
  if (!organizersEnabled(env)) why = why_.off(name);
  else if (!isStaff(role)) why = why_.former(name);
  else if (!m.chat_id) why = `${ROLE_TITLE[role]} ${name} 还没连接 Telegram`;
  else if (await sendTo(env, m.chat_id, withAdminLink(env, html, adminPage)))
    return { ok: true, owner: false, organizer: m.username, chatId: m.chat_id };
  else why = `发给${ROLE_TITLE[role]} ${name} 的 Telegram 没有成功`;
  const ok = await sendToOwner(env, `ℹ️ ${why}，这条发给群主。\n${html}`);
  return { ok, owner: true, organizer: m.username, chatId: null };
}

/** sendToPayee, plus a copy for the Owner when the organizer got it (转发可能中断). */
export async function sendToPayeeAndOwner(env: Env, payeeId: string, html: string): Promise<boolean> {
  const d = await sendToPayee(env, payeeId, html);
  if (d.ok && !d.owner) await sendToOwner(env, `📋 抄送：组织者 ${escapeHtml(d.organizer!)} 的收款账户\n${html}`);
  return d.ok;
}

/**
 * sendToManager, plus a copy for the Owner when an organizer got it (群主抄送: only 新活动发起,
 * 结算完成 and 收齐). The copy is best effort: the notice counts as sent once the manager has it.
 */
export async function sendToManagerAndOwner(
  env: Env,
  e: { manager_id: string | null },
  html: string,
  adminPage = false,
): Promise<boolean> {
  const d = await sendToManager(env, e, html, adminPage);
  if (d.ok && !d.owner) await sendToOwner(env, `📋 抄送：组织者 ${escapeHtml(d.organizer!)} 负责的活动\n${html}`);
  return d.ok;
}

/**
 * Telegram echoes this in X-Telegram-Bot-Api-Secret-Token, proving a webhook call is genuine. A
 * random one is stored when the webhook is set, so it survives a replaced TOKEN_KEY; webhooks set
 * before that still use the one derived from TOKEN_KEY until the Owner connects again.
 */
export async function webhookSecret(env: Env): Promise<string> {
  const { telegram_webhook_secret: stored } = await getSettings(env.DB, ["telegram_webhook_secret"]);
  return stored || (await hmac("telegram-webhook", env.TOKEN_KEY)).slice(0, 48);
}

/**
 * Points the bot at our webhook and keeps the secret once Telegram has it. Every call uses the same
 * secret (the stored one, else one claimed once in telegram_webhook_secret_next), so a cron upgrade
 * and an Owner reconnecting at the same moment can't leave Telegram and the database on different ones.
 */
async function setWebhook(env: Env): Promise<TgResult<unknown>> {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('telegram_webhook_secret_next', ?) ON CONFLICT (key) DO NOTHING",
  )
    .bind(randomToken())
    .run();
  const s = await getSettings(env.DB, ["telegram_webhook_secret", "telegram_webhook_secret_next"]);
  const secret = s.telegram_webhook_secret || s.telegram_webhook_secret_next!;
  const hook = await call(env, "setWebhook", {
    url: `${env.SITE_ORIGIN}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
  });
  if (hook.ok) await setSetting(env.DB, "telegram_webhook_secret", secret).run();
  return hook;
}

/**
 * From the cron: a chat connected before the secret was stored still has the one derived from
 * TOKEN_KEY, so a replaced key would silence the bot. Moves it to a stored secret once.
 */
export async function upgradeWebhookSecret(env: Env): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const s = await getSettings(env.DB, ["telegram_chat_id", "telegram_webhook_secret"]);
  if (!s.telegram_chat_id || s.telegram_webhook_secret) return;
  const hook = await setWebhook(env);
  if (!hook.ok) console.error("telegram setWebhook failed:", hook.description);
}

export interface TelegramStatus {
  botReady: boolean;
  botUsername: string;
  connected: boolean;
  chatName: string;
  /** The 组织者 feature is on: event notices go to whoever runs the event. */
  organizers: boolean;
}

/**
 * Whose chat a settings page manages: the Owner's (null, kept in `settings`) or an organizer's
 * (their member id, in telegram_bindings).
 */
export type ChatOwner = string | null;

export async function telegramStatus(env: Env, who: ChatOwner): Promise<TelegramStatus> {
  const s = await getSettings(env.DB, ["telegram_chat_id", "telegram_chat_name", "telegram_bot_username"]);
  const chat =
    who === null
      ? { chat_id: s.telegram_chat_id ?? null, chat_name: s.telegram_chat_name ?? null }
      : await env.DB.prepare("SELECT chat_id, chat_name FROM telegram_bindings WHERE member_id = ?")
          .bind(who)
          .first<{ chat_id: string | null; chat_name: string | null }>();
  return {
    botReady: !!env.TELEGRAM_BOT_TOKEN,
    botUsername: s.telegram_bot_username ?? "",
    connected: !!chat?.chat_id,
    chatName: chat?.chat_name ?? "",
    organizers: organizersEnabled(env),
  };
}

/**
 * Starts binding: makes sure Telegram delivers messages to our webhook, then returns a t.me link
 * whose one-time code is good for 10 minutes. Each person's code is kept with them, so two people
 * connecting at once don't replace each other's.
 */
export async function startBinding(env: Env, who: ChatOwner): Promise<string> {
  if (!env.TELEGRAM_BOT_TOKEN)
    throw new HttpError(400, "no_bot", "还没有配置 Telegram 机器人（GitHub secret TELEGRAM_BOT_TOKEN）");
  const me = await call<{ username: string }>(env, "getMe", {});
  if (!me.ok || !me.result) throw new HttpError(502, "telegram", `连接 Telegram 失败：${me.description ?? "未知错误"}`);
  const hook = await setWebhook(env);
  if (!hook.ok) throw new HttpError(502, "telegram", `设置 Telegram 回调失败：${hook.description ?? "未知错误"}`);
  // Shows /admin in the bot's menu; best effort.
  await call(env, "setMyCommands", { commands: [{ command: "admin", description: "获取管理页面链接" }] });
  const code = randomToken();
  const hash = await sha256(code);
  const expires = new Date(Date.now() + BIND_MINUTES * 60_000).toISOString();
  await env.DB.batch([
    setSetting(env.DB, "telegram_bot_username", me.result.username),
    ...(who === null
      ? [setSetting(env.DB, "telegram_bind_hash", hash), setSetting(env.DB, "telegram_bind_expires", expires)]
      : [
          env.DB.prepare(
            `INSERT INTO telegram_bindings (member_id, bind_hash, bind_expires) VALUES (?, ?, ?)
             ON CONFLICT (member_id) DO UPDATE SET bind_hash = excluded.bind_hash, bind_expires = excluded.bind_expires`,
          ).bind(who, hash, expires),
        ]),
  ]);
  return `https://t.me/${me.result.username}?start=${code}`;
}

export async function disconnect(env: Env, who: ChatOwner): Promise<void> {
  if (who === null)
    await env.DB.prepare("DELETE FROM settings WHERE key IN ('telegram_chat_id', 'telegram_chat_name')").run();
  else await env.DB.prepare("DELETE FROM telegram_bindings WHERE member_id = ?").bind(who).run();
}

interface Update {
  message?: {
    text?: string;
    chat?: { id: number; type: string; first_name?: string; last_name?: string; username?: string };
  };
}

const ADMIN_LINK_WORDS = new Set(["管理页面", "管理页", "管理链接", "/admin", "/start admin"]);

/**
 * Handles a webhook update. Two things do anything: "/start <valid code>" binds a private chat to
 * whoever the code was made for, and 「管理页面」 gets the Owner's chat the current admin link (and a
 * current organizer's chat their Google way in). Everything else is ignored.
 */
export async function handleUpdate(env: Env, update: Update): Promise<void> {
  const msg = update.message;
  const text = msg?.text?.trim() ?? "";
  if (msg?.chat?.type !== "private") return;
  if (ADMIN_LINK_WORDS.has(text)) return sendAdminLink(env, String(msg.chat.id));
  const m = /^\/start\s+([A-Za-z0-9_-]{20,64})$/.exec(text);
  if (!m) return;
  const hash = await sha256(m[1]!);
  const c = msg.chat;
  const chatId = String(c.id);
  const name = (
    [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.username ? `@${c.username}` : "Telegram")
  ).slice(0, 60);

  const s = await getSettings(env.DB, ["telegram_bind_hash", "telegram_bind_expires"]);
  if (s.telegram_bind_hash === hash && s.telegram_bind_expires && s.telegram_bind_expires >= now()) {
    await env.DB.batch([
      setSetting(env.DB, "telegram_chat_id", chatId),
      setSetting(env.DB, "telegram_chat_name", name),
      env.DB.prepare("DELETE FROM settings WHERE key IN ('telegram_bind_hash', 'telegram_bind_expires')"),
    ]);
    await sendToOwner(
      env,
      "✅ 已连接。羽毛球群的提醒、结算和账单提醒都会发到这里。\n忘记管理页面地址时，在这里发送「管理页面」即可找回。",
    );
    return;
  }

  // Revoked (or the feature switched off) after making the code: it no longer connects anything.
  if (!organizersEnabled(env)) return;
  // Spends the code and binds in one transaction, only while the code is valid and its owner is
  // still an organizer, so a revoke or a second /start with the same code can't slip in between.
  const ts = now();
  const claim = `(SELECT t.member_id FROM telegram_bindings t JOIN members m ON m.id = t.member_id
     WHERE t.bind_hash = ?1 AND t.bind_expires >= ?2
       AND ${currentStaffSql("m")})`;
  const [, bound] = await env.DB.batch([
    // One chat belongs to one organizer: the same Telegram account connected again moves here.
    env.DB.prepare(
      `UPDATE telegram_bindings SET chat_id = NULL, chat_name = NULL
       WHERE chat_id = ?3 AND EXISTS ${claim} AND member_id != ${claim}`,
    ).bind(hash, ts, chatId),
    env.DB.prepare(
      `UPDATE telegram_bindings SET chat_id = ?3, chat_name = ?4, bind_hash = NULL, bind_expires = NULL
       WHERE member_id = ${claim}`,
    ).bind(hash, ts, chatId, name),
  ]);
  if (!bound?.meta.changes) return;
  await sendTo(
    env,
    chatId,
    `✅ 已连接。你负责的活动的提醒、结算和账单提醒都会发到这里。\n管理页（用 Google 登录）：${escapeHtml(organizerAdminLink(env))}`,
  );
}

/**
 * An organizer asking for the admin page gets their way in (Google), never the admin link. Only a
 * current organizer's connected chat; strangers and revoked organizers hear nothing.
 */
async function organizerAdminEntry(env: Env, chatId: string): Promise<void> {
  if (!organizersEnabled(env)) return;
  const o = await env.DB.prepare(
    `SELECT 1 FROM telegram_bindings t JOIN members m ON m.id = t.member_id
     WHERE t.chat_id = ? AND ${currentStaffSql("m")}`,
  )
    .bind(chatId)
    .first();
  if (o) await sendTo(env, chatId, `🔑 管理页（用 Google 登录）：\n${escapeHtml(organizerAdminLink(env))}`);
}

async function sendAdminLink(env: Env, chatId: string): Promise<void> {
  const { telegram_chat_id: bound } = await getSettings(env.DB, ["telegram_chat_id"]);
  if (!bound || bound !== chatId) return organizerAdminEntry(env, chatId); // the admin link: only the Owner's own chat
  const { token, renewed } = await currentAdminToken(env);
  const link = `${env.SITE_ORIGIN}/admin/${token}`;
  const note = renewed ? "\n（之前的管理链接无法找回，已为你生成新的，旧链接已失效。）" : "";
  await sendToOwner(env, `🔑 管理页面：\n${escapeHtml(link)}\n打开后还需要输入群主密码。请不要转发这个链接。${note}`);
}
