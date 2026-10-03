import { getSettings, now, setSetting } from "./db";
import type { Env } from "./env";
import { HttpError } from "./http";
import { hmac, randomToken, sha256 } from "./lib/crypto";
import { currentAdminToken } from "./auth";

/**
 * One bot (created by whoever hosts the site) talks to exactly one chat: the Owner's. The chat is
 * bound from the admin page with a one-time code carried by a t.me start link, so nobody who
 * merely finds the bot can receive anything. Binding again replaces the previous chat.
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

/** Sends an HTML message to the bound Owner chat. False when not set up or Telegram refused it. */
export async function sendToOwner(env: Env, html: string): Promise<boolean> {
  const { telegram_chat_id: chatId } = await getSettings(env.DB, ["telegram_chat_id"]);
  if (!chatId) return false;
  const r = await call(env, "sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  if (!r.ok) console.error("telegram send failed:", r.description);
  return r.ok;
}

/** Telegram echoes this in X-Telegram-Bot-Api-Secret-Token, proving a webhook call is genuine. */
export async function webhookSecret(env: Env): Promise<string> {
  return (await hmac("telegram-webhook", env.TOKEN_KEY)).slice(0, 48);
}

export interface TelegramStatus {
  botReady: boolean;
  botUsername: string;
  connected: boolean;
  chatName: string;
}

export async function telegramStatus(env: Env): Promise<TelegramStatus> {
  const s = await getSettings(env.DB, ["telegram_chat_id", "telegram_chat_name", "telegram_bot_username"]);
  return {
    botReady: !!env.TELEGRAM_BOT_TOKEN,
    botUsername: s.telegram_bot_username ?? "",
    connected: !!s.telegram_chat_id,
    chatName: s.telegram_chat_name ?? "",
  };
}

/**
 * Starts binding: makes sure Telegram delivers messages to our webhook, then returns a t.me link
 * whose one-time code is good for 10 minutes.
 */
export async function startBinding(env: Env): Promise<string> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new HttpError(400, "no_bot", "还没有配置 Telegram 机器人（GitHub secret TELEGRAM_BOT_TOKEN）");
  const me = await call<{ username: string }>(env, "getMe", {});
  if (!me.ok || !me.result) throw new HttpError(502, "telegram", `连接 Telegram 失败：${me.description ?? "未知错误"}`);
  const hook = await call(env, "setWebhook", {
    url: `${env.SITE_ORIGIN}/api/telegram/webhook`,
    secret_token: await webhookSecret(env),
    allowed_updates: ["message"],
  });
  if (!hook.ok) throw new HttpError(502, "telegram", `设置 Telegram 回调失败：${hook.description ?? "未知错误"}`);
  // Shows /admin in the bot's menu; best effort.
  await call(env, "setMyCommands", { commands: [{ command: "admin", description: "获取管理页面链接" }] });
  const code = randomToken();
  await env.DB.batch([
    setSetting(env.DB, "telegram_bot_username", me.result.username),
    setSetting(env.DB, "telegram_bind_hash", await sha256(code)),
    setSetting(env.DB, "telegram_bind_expires", new Date(Date.now() + BIND_MINUTES * 60_000).toISOString()),
  ]);
  return `https://t.me/${me.result.username}?start=${code}`;
}

export async function disconnect(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key IN ('telegram_chat_id', 'telegram_chat_name')").run();
}

interface Update {
  message?: {
    text?: string;
    chat?: { id: number; type: string; first_name?: string; last_name?: string; username?: string };
  };
}

const ADMIN_LINK_WORDS = new Set(["管理页面", "管理页", "管理链接", "/admin", "/start admin"]);

/**
 * Handles a webhook update. Two things do anything: "/start <valid code>" binds a private chat,
 * and 「管理页面」 from the bound chat gets the current admin link. Everything else is ignored.
 */
export async function handleUpdate(env: Env, update: Update): Promise<void> {
  const msg = update.message;
  const text = msg?.text?.trim() ?? "";
  if (!msg?.chat || msg.chat.type !== "private") return;
  if (ADMIN_LINK_WORDS.has(text)) return sendAdminLink(env, String(msg.chat.id));
  const m = /^\/start\s+([A-Za-z0-9_-]{20,64})$/.exec(text);
  if (!m) return;
  const s = await getSettings(env.DB, ["telegram_bind_hash", "telegram_bind_expires"]);
  if (!s.telegram_bind_hash || !s.telegram_bind_expires || s.telegram_bind_expires < now()) return;
  if ((await sha256(m[1]!)) !== s.telegram_bind_hash) return;

  const c = msg.chat;
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.username ? `@${c.username}` : "Telegram");
  await env.DB.batch([
    setSetting(env.DB, "telegram_chat_id", String(c.id)),
    setSetting(env.DB, "telegram_chat_name", name.slice(0, 60)),
    env.DB.prepare("DELETE FROM settings WHERE key IN ('telegram_bind_hash', 'telegram_bind_expires')"),
  ]);
  await sendToOwner(env, "✅ 已连接。羽毛球群的提醒、结算和账单提醒都会发到这里。\n忘记管理页面地址时，在这里发送「管理页面」即可找回。");
}

async function sendAdminLink(env: Env, chatId: string): Promise<void> {
  const { telegram_chat_id: bound } = await getSettings(env.DB, ["telegram_chat_id"]);
  if (!bound || bound !== chatId) return; // only the Owner's own chat
  const { token, renewed } = await currentAdminToken(env);
  const link = `${env.SITE_ORIGIN}/admin/${token}`;
  const note = renewed ? "\n（之前的管理链接无法找回，已为你生成新的，旧链接已失效。）" : "";
  await sendToOwner(env, `🔑 管理页面：\n${escapeHtml(link)}\n打开后还需要输入管理密码。请不要转发这个链接。${note}`);
}
