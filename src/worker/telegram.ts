import { getSettings, now, setSetting } from "./db";
import type { Env } from "./env";
import { HttpError } from "./http";
import { hmac, randomToken, sha256 } from "./lib/crypto";
import { currentAdminToken } from "./auth";
import { ROLE_TITLE, currentStaffSql, eventManager, isStaff, memberRole, organizersEnabled } from "./organizers";
import { BOT_LANGS, type BotLang, type BotText, bt, chatLang, initChatLang, setChatLang } from "./botLang";

/**
 * One bot (created by whoever hosts the site) talks to one chat per person: the Owner's, kept in
 * `settings` as before, and each organizer's, in their telegram_bindings row. A chat is bound from
 * the admin page with a one-time code carried by a t.me start link, so nobody who merely finds the
 * bot can receive anything. Binding again replaces that person's previous chat. Every message is a
 * BotText, written in the language that chat picked (botLang.ts).
 */

const BIND_MINUTES = 10;
/** Bumped when the bot's menu changes, so the cron sets it again (telegram_commands). */
const COMMANDS_VERSION = "2";

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

async function sendTo(env: Env, chatId: string, text: BotText, replyMarkup?: unknown): Promise<boolean> {
  const r = await call(env, "sendMessage", {
    chat_id: chatId,
    text: await text(await chatLang(env, chatId)),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  if (!r.ok) console.error("telegram send failed:", r.description);
  return r.ok;
}

/** Sends an HTML message to the bound Owner chat. False when not set up or Telegram refused it. */
export async function sendToOwner(env: Env, text: BotText): Promise<boolean> {
  const { telegram_chat_id: chatId } = await getSettings(env.DB, ["telegram_chat_id"]);
  if (!chatId) return false;
  return sendTo(env, chatId, text);
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
export const wechatBlock = (l: BotLang) => `\n\n${bt(l, "—— 可复制到微信 ——")}\n`;

/** Where an organizer opens the admin pages: through Google, never the Owner's admin link. */
export const organizerAdminLink = (env: Env) => `${env.SITE_ORIGIN}/admin/google`;

/**
 * Puts the organizer's way into the admin pages under a notice that sends them there (`adminPage`),
 * before the WeChat block.
 */
function withAdminLink(env: Env, l: BotLang, html: string, adminPage: boolean): string {
  if (!adminPage) return html;
  const link = bt(l, "管理页（用 Google 登录）：{link}", { link: escapeHtml(organizerAdminLink(env)) });
  const cut = html.indexOf(wechatBlock(l));
  return cut < 0 ? `${html}\n\n${link}` : `${html.slice(0, cut)}\n\n${link}${html.slice(cut)}`;
}

/**
 * Sends to one person's own chat: the Owner's, or a current organizer's or admin's (only while the
 * feature is on). False when they have none, are no longer one, or Telegram refused it.
 */
export async function sendToMember(env: Env, memberId: string, text: BotText): Promise<boolean> {
  const m = await recipient(env.DB, memberId);
  if (!m) return false;
  const role = memberRole(env, m);
  if (role === "owner") return sendToOwner(env, text);
  if (!isStaff(role) || !m.chat_id) return false;
  return sendTo(env, m.chat_id, text);
}

/** Every current admin's own chat, only while the feature is on. */
async function adminChats(env: Env): Promise<string[]> {
  if (!organizersEnabled(env)) return [];
  const { results } = await env.DB.prepare(
    `SELECT t.chat_id FROM telegram_bindings t JOIN members m ON m.id = t.member_id
     WHERE t.chat_id IS NOT NULL AND m.role = 'admin' AND ${currentStaffSql("m")}`,
  ).all<{ chat_id: string }>();
  return results.map((r) => r.chat_id);
}

/**
 * Sends to every current admin's own chat (新成员申请, admin-role.zh.md §6), only while the feature
 * is on. True when at least one of them got it.
 */
export async function sendToAdmins(env: Env, text: BotText): Promise<boolean> {
  const chats = await adminChats(env);
  const sent = await Promise.all(
    chats.map((chat) => sendTo(env, chat, async (l) => withAdminLink(env, l, await text(l), true))),
  );
  return sent.some(Boolean);
}

/**
 * Sends to the Owner and every current admin (admins only while the feature is on), each in their
 * own bot language, leaving out the chats in `skip`; a chat shared by two of them gets it once.
 * Which chats there were, and which of them took it.
 */
export async function sendToOwnerAndAdmins(
  env: Env,
  text: BotText,
  skip: ReadonlySet<string> = new Set(),
): Promise<{ chats: string[]; delivered: string[] }> {
  const { telegram_chat_id: owner } = await getSettings(env.DB, ["telegram_chat_id"]);
  const chats = [...new Set([...(owner ? [owner] : []), ...(await adminChats(env))])];
  const todo = chats.filter((c) => !skip.has(c));
  const ok = await Promise.all(todo.map((chat) => sendTo(env, chat, text)));
  return { chats, delivered: todo.filter((_, i) => ok[i]) };
}

export interface ManagerDelivery {
  ok: boolean;
  /** Whether it went to the Owner: the event is theirs, or it fell back to them. */
  owner: boolean;
  /** The organizer or admin who runs the event, when that is not the Owner. */
  organizer: string | null;
  /** 组织者 or 管理员 (a botMessages key), when it went to them: the Owner's copy names them so. */
  title: string | null;
  /** The organizer's chat when it went there. */
  chatId: string | null;
}

/** Sends a follow-up to wherever an earlier sendToManager went, so a run of messages stays together. */
export async function sendLikewise(env: Env, d: ManagerDelivery, text: BotText): Promise<boolean> {
  return d.owner || !d.chatId ? sendToOwner(env, text) : sendTo(env, d.chatId, text);
}

/**
 * An event's notice goes to whoever runs it (design §7). When that is an organizer who can't get
 * it (no Telegram, no longer an organizer, the feature off, or Telegram refused it), it goes to the
 * Owner instead, opening with why.
 */
export async function sendToManager(
  env: Env,
  e: { manager_id: string | null },
  text: BotText,
  adminPage = false,
): Promise<ManagerDelivery> {
  return sendToResponsible(env, await eventManager(env.DB, e), text, adminPage, {
    off: "这场由 {name} 负责，但组织者功能已关闭，这条发给群主。",
    former: "这场的负责人 {name} 已经不是组织者或管理员，这条发给群主。",
  });
}

/**
 * A notice about money that went into someone's account (待确认, 转发可能中断) goes to that
 * account's owner (design §7): a current organizer, else the Owner, opening with why when it
 * falls back. A 历史收款人's go to the Owner, who handles them now.
 */
export async function sendToPayee(env: Env, payeeId: string | null, text: BotText): Promise<ManagerDelivery> {
  return sendToResponsible(env, payeeId, text, true, {
    off: "这条是关于 {name} 的收款账户的，但组织者功能已关闭，这条发给群主。",
    former: "这条是关于历史收款人 {name} 的收款账户的（已经不是组织者或管理员），这条发给群主。",
  });
}

async function sendToResponsible(
  env: Env,
  id: string | null,
  text: BotText,
  adminPage: boolean,
  why_: { off: string; former: string },
): Promise<ManagerDelivery> {
  const m = id ? await recipient(env.DB, id) : null;
  if (!m || m.is_owner === 1)
    return { ok: await sendToOwner(env, text), owner: true, organizer: null, title: null, chatId: null };
  const name = escapeHtml(m.username);
  // Why it went to the Owner instead: a botMessages key, with the role title translated too.
  let why: string;
  const role = memberRole(env, m);
  if (!organizersEnabled(env)) why = why_.off;
  else if (!isStaff(role)) why = why_.former;
  else if (!m.chat_id) why = "{title} {name} 还没连接 Telegram，这条发给群主。";
  else if (await sendTo(env, m.chat_id, async (l) => withAdminLink(env, l, await text(l), adminPage)))
    return { ok: true, owner: false, organizer: m.username, title: ROLE_TITLE[role], chatId: m.chat_id };
  else why = "发给{title} {name} 的 Telegram 没有成功，这条发给群主。";
  const title = isStaff(role) ? ROLE_TITLE[role] : "";
  const ok = await sendToOwner(env, async (l) => `ℹ️ ${bt(l, why, { name, title: bt(l, title) })}\n${await text(l)}`);
  return { ok, owner: true, organizer: m.username, title: null, chatId: null };
}

/** sendToPayee, plus a copy for the Owner when the organizer or admin got it (转发可能中断). */
export async function sendToPayeeAndOwner(env: Env, payeeId: string, text: BotText): Promise<boolean> {
  const d = await sendToPayee(env, payeeId, text);
  if (d.ok && !d.owner)
    await sendToOwner(
      env,
      async (l) =>
        `📋 ${bt(l, "抄送：{title} {name} 的收款账户", { title: bt(l, d.title!), name: escapeHtml(d.organizer!) })}\n${await text(l)}`,
    );
  return d.ok;
}

/**
 * sendToManager, plus a copy for the Owner when an organizer or admin got it (群主抄送: only 新活动发起,
 * 结算完成 and 收齐). The copy is best effort: the notice counts as sent once the manager has it.
 */
export async function sendToManagerAndOwner(
  env: Env,
  e: { manager_id: string | null },
  text: BotText,
  adminPage = false,
): Promise<boolean> {
  const d = await sendToManager(env, e, text, adminPage);
  if (d.ok && !d.owner)
    await sendToOwner(
      env,
      async (l) =>
        `📋 ${bt(l, "抄送：{title} {name} 负责的活动", { title: bt(l, d.title!), name: escapeHtml(d.organizer!) })}\n${await text(l)}`,
    );
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
  if (await setCommands(env)) await setSetting(env.DB, "telegram_commands", COMMANDS_VERSION).run();
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

/** The bot's menu (/admin, /language), in English for Telegram set to English; best effort. */
async function setCommands(env: Env): Promise<boolean> {
  const menu = (l: BotLang) => [
    { command: "admin", description: bt(l, "获取管理页面链接") },
    { command: "language", description: bt(l, "切换语言 / Language") },
  ];
  const [zh, en] = await Promise.all([
    call(env, "setMyCommands", { commands: menu("zh-CN") }),
    call(env, "setMyCommands", { commands: menu("en"), language_code: "en" }),
  ]);
  return zh.ok && en.ok;
}

/** From the cron: a bot set up before /language was in its menu gets it, once. */
export async function upgradeCommands(env: Env): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const s = await getSettings(env.DB, ["telegram_chat_id", "telegram_commands"]);
  if (s.telegram_commands === COMMANDS_VERSION) return;
  // Only a bot someone has connected: the Owner, or an organizer or admin.
  const used =
    s.telegram_chat_id ||
    (await env.DB.prepare("SELECT 1 FROM telegram_bindings WHERE chat_id IS NOT NULL LIMIT 1").first());
  if (!used) return;
  if (await setCommands(env)) await setSetting(env.DB, "telegram_commands", COMMANDS_VERSION).run();
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
    from?: { language_code?: string };
  };
}

const ADMIN_LINK_WORDS = new Set([
  "管理页面",
  "管理页",
  "管理链接",
  "管理頁面",
  "管理頁",
  "管理連結",
  "admin",
  "admin page",
  "/admin",
  "/start admin",
]);
const LANG_WORDS = new Set(["语言", "語言", "language", "lang", "/language", "/lang", "/start language"]);

/**
 * Handles a webhook update. Three things do anything: "/start <valid code>" binds a private chat to
 * whoever the code was made for; 「管理页面」 gets the Owner's chat the current admin link (and a
 * current organizer's chat their Google way in); 「语言」 lets a connected chat pick the language
 * the bot writes to it in. Everything else is ignored.
 */
export async function handleUpdate(env: Env, update: Update): Promise<void> {
  const msg = update.message;
  const text = msg?.text?.trim() ?? "";
  if (msg?.chat?.type !== "private") return;
  const word = text.toLowerCase();
  if (ADMIN_LINK_WORDS.has(word)) return sendAdminLink(env, String(msg.chat.id));
  if (LANG_WORDS.has(word)) return askLanguage(env, String(msg.chat.id));
  const picked = BOT_LANGS.find((x) => x.name.toLowerCase() === word);
  if (picked) return pickLanguage(env, String(msg.chat.id), picked.id);
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
    await initChatLang(env, chatId, msg.from?.language_code);
    await sendToOwner(
      env,
      (l) =>
        `${bt(l, "✅ 已连接。羽毛球群的提醒、结算和账单提醒都会发到这里。\n忘记管理页面地址时，在这里发送「管理页面」即可找回。")}\n${langTip(l)}`,
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
  await initChatLang(env, chatId, msg.from?.language_code);
  await sendTo(
    env,
    chatId,
    (l) =>
      `${bt(l, "✅ 已连接。你负责的活动的提醒、结算和账单提醒（管理员还有入群申请）都会发到这里。\n管理页（用 Google 登录）：{link}", { link: escapeHtml(organizerAdminLink(env)) })}\n${langTip(l)}`,
  );
}

/** Under 已连接: how to change the language, readable whichever one it is in. */
const langTip = (l: BotLang) => bt(l, "发送「语言」可以切换语言（简体 / 繁體 / English）。");

/**
 * Whether this is someone's connected chat: the Owner's, or a current organizer's or admin's.
 * Strangers and revoked organizers hear nothing.
 */
async function connected(env: Env, chatId: string): Promise<boolean> {
  const { telegram_chat_id: owner } = await getSettings(env.DB, ["telegram_chat_id"]);
  if (owner === chatId) return true;
  if (!organizersEnabled(env)) return false;
  const o = await env.DB.prepare(
    `SELECT 1 FROM telegram_bindings t JOIN members m ON m.id = t.member_id
     WHERE t.chat_id = ? AND ${currentStaffSql("m")}`,
  )
    .bind(chatId)
    .first();
  return !!o;
}

/** 「语言」: the three languages as buttons under the message box; tapping one sends its name. */
async function askLanguage(env: Env, chatId: string): Promise<void> {
  if (!(await connected(env, chatId))) return;
  await sendTo(env, chatId, (l) => bt(l, "请选择 Telegram 通知的语言（只影响这个聊天，不影响网页）："), {
    keyboard: [BOT_LANGS.map((x) => ({ text: x.name }))],
    one_time_keyboard: true,
    resize_keyboard: true,
  });
}

async function pickLanguage(env: Env, chatId: string, lang: BotLang): Promise<void> {
  if (!(await connected(env, chatId))) return;
  await setChatLang(env, chatId, lang);
  const name = BOT_LANGS.find((x) => x.id === lang)!.name;
  await sendTo(env, chatId, (l) => bt(l, "✅ 以后的通知都会用{name}。", { name }), { remove_keyboard: true });
}

/**
 * An organizer asking for the admin page gets their way in (Google), never the admin link. Only a
 * current organizer's connected chat; strangers and revoked organizers hear nothing.
 */
async function organizerAdminEntry(env: Env, chatId: string): Promise<void> {
  if (await connected(env, chatId))
    await sendTo(
      env,
      chatId,
      (l) => `🔑 ${bt(l, "管理页（用 Google 登录）：")}\n${escapeHtml(organizerAdminLink(env))}`,
    );
}

async function sendAdminLink(env: Env, chatId: string): Promise<void> {
  const { telegram_chat_id: bound } = await getSettings(env.DB, ["telegram_chat_id"]);
  if (!bound || bound !== chatId) return organizerAdminEntry(env, chatId); // the admin link: only the Owner's own chat
  const { token, renewed } = await currentAdminToken(env);
  const link = `${env.SITE_ORIGIN}/admin/${token}`;
  await sendToOwner(
    env,
    (l) =>
      `🔑 ${bt(l, "管理页面：")}\n${escapeHtml(link)}\n${bt(l, "打开后还需要输入群主密码。请不要转发这个链接。")}` +
      (renewed ? `\n${bt(l, "（之前的管理链接无法找回，已为你生成新的，旧链接已失效。）")}` : ""),
  );
}
