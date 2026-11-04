import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { Card, Field, Load, useAction } from "../components";
import { type Loaded, useApi } from "../hooks";

export interface TelegramStatus {
  botReady: boolean;
  botInSettings: boolean;
  botUsername: string;
  connected: boolean;
  chatName: string;
  organizers: boolean;
}

/**
 * Connects the signed-in person's own Telegram (the Owner's, or an organizer's with `organizer`)
 * with a one-time link, and sends a test message. The page loads the status and passes it in, so
 * the guide's checklist on the same page ticks when this connects.
 */
export function TelegramCard(props: {
  base: string;
  organizer?: boolean;
  /** An admin's own chat (with `organizer`): new applications come here too. */
  admin?: boolean;
  status: Loaded<TelegramStatus>;
  reload: () => void;
}) {
  const { status, reload } = props;
  const [waiting, setWaiting] = useState(false);
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState(false);
  const [changingBot, setChangingBot] = useState(false);

  // After opening Telegram, check every few seconds until Start has been tapped (up to the 10 minutes the link is valid).
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const t = setInterval(async () => {
      const s = await api<TelegramStatus>(`${props.base}/telegram`).catch(() => null);
      if (s?.connected || Date.now() - started > 600_000) {
        setWaiting(false);
        reload();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting]);

  async function connect() {
    const r = await run(() => api<{ link: string }>(`${props.base}/telegram/connect`, {}));
    if (!r) return;
    setWaiting(true);
    if (!window.open(r.link, "_blank")) location.href = r.link;
  }
  async function test() {
    setSent(false);
    if (await run(() => api(`${props.base}/telegram/test`, {}))) setSent(true);
  }
  async function unlink() {
    const warn = props.organizer
      ? "断开后，你负责的活动的提醒会改发给群主。继续吗？"
      : "断开后不再收到任何通知。继续吗？";
    if (!confirm(warn)) return;
    if (await run(() => api(`${props.base}/telegram/disconnect`, {}))) reload();
  }

  return (
    <Card title={props.organizer ? "我的 Telegram" : "Telegram 通知"}>
      <Load result={status}>
        {(s) =>
          !s.botReady || changingBot ? (
            s.botInSettings && !props.organizer ? (
              <BotTokenForm
                base={props.base}
                replacing={s.botReady}
                onSaved={() => {
                  setChangingBot(false);
                  reload();
                }}
              />
            ) : (
              <p class="muted">
                {s.botInSettings
                  ? "还没有配置机器人，请群主在设置里填上机器人的 token。"
                  : "还没有配置机器人。请网站维护者在 GitHub secret 里加上 TELEGRAM_BOT_TOKEN 并重新部署。"}
              </p>
            )
          ) : (
            <>
              {s.connected ? (
                <p>
                  ✓ 已连接：<strong>{s.chatName}</strong>
                  {s.botUsername && <span class="muted small">（机器人 @{s.botUsername}）</span>}
                </p>
              ) : (
                <p class="muted">
                  还没有连接。点下面的按钮会打开 Telegram，在机器人对话里点「Start / 开始」即可。
                  {props.organizer
                    ? `连接后，你负责的活动的报名截止、结算和收款提醒${props.admin ? "，以及新成员的入群申请" : ""}会发到这里；没连接时活动的提醒发给群主。`
                    : s.organizers
                      ? "你负责的活动的提醒和账单通知、组织者活动的抄送（发起、结算完成、收齐），以及入群申请等全群的通知发到连接的这个账号。"
                      : "所有提醒和账单通知只发给连接的这一个账号。"}
                </p>
              )}
              {waiting && <p class="hint">等待你在 Telegram 里点 Start…（10 分钟内有效）</p>}
              {error && <p class="error">{error}</p>}
              {sent && <p class="muted small">已发送，请在 Telegram 里查看。</p>}
              <button
                type="button"
                class={`button block ${s.connected ? "secondary" : ""}`}
                disabled={busy}
                onClick={connect}
              >
                {s.connected ? "换一个 Telegram 账号" : "连接 Telegram"}
              </button>
              {s.connected && (
                <>
                  <button type="button" class="button secondary block" disabled={busy} onClick={test}>
                    发送测试消息
                  </button>
                  <button type="button" class="link-button" disabled={busy} onClick={unlink}>
                    断开连接
                  </button>
                </>
              )}
              {s.botInSettings && !props.organizer && (
                <button type="button" class="link-button" disabled={busy} onClick={() => setChangingBot(true)}>
                  更换机器人
                </button>
              )}
            </>
          )
        }
      </Load>
    </Card>
  );
}

/** The Owner pastes the token BotFather gave them; the server checks it with Telegram before keeping it. */
function BotTokenForm(props: { base: string; replacing: boolean; onSaved: () => void }) {
  const [token, setToken] = useState("");
  const { busy, error, run } = useAction();
  async function save() {
    if (props.replacing && !confirm("换成新机器人后，群主和组织者都要重新连接 Telegram。继续吗？")) return;
    if (await run(() => api(`${props.base}/settings/telegram-bot`, { token }))) props.onSaved();
  }
  return (
    <>
      <p class="muted">
        在 Telegram 里找 @BotFather，发送 /newbot 建一个机器人，把它给的 token
        粘贴到这里。之后群主和组织者各自连接这个机器人接收通知。
      </p>
      <Field label="机器人 token" value={token} onInput={setToken} verbatim autocomplete="off" />
      {error && <p class="error">{error}</p>}
      <button type="button" class="button block" disabled={busy || !token.trim()} onClick={save}>
        保存机器人
      </button>
    </>
  );
}

interface ReminderSettings {
  reminderEnabled: boolean;
  reminderHours: number;
  dunningHour: number;
  weeklyDigest: boolean;
}

export function RemindersCard(props: { base: string }) {
  const [s] = useApi<ReminderSettings>(`${props.base}/settings`);
  return <Load result={s}>{(v) => <RemindersForm base={props.base} initial={v} />}</Load>;
}

function RemindersForm(props: { base: string; initial: ReminderSettings }) {
  const [enabled, setEnabled] = useState(props.initial.reminderEnabled);
  const [hours, setHours] = useState(String(props.initial.reminderHours));
  const [dunning, setDunning] = useState(props.initial.dunningHour);
  const [digest, setDigest] = useState(props.initial.weeklyDigest);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  async function save() {
    const body = { reminderEnabled: enabled, reminderHours: Number(hours), dunningHour: dunning, weeklyDigest: digest };
    if (await run(() => api(`${props.base}/settings`, body))) setSaved(true);
  }

  return (
    <Card title="提醒设置">
      <label class="check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled((e.target as HTMLInputElement).checked);
            setSaved(false);
          }}
        />
        报名截止前提醒
      </label>
      {enabled && (
        <Field
          label="截止前几小时提醒"
          type="number"
          value={hours}
          onInput={(v) => {
            setHours(v);
            setSaved(false);
          }}
        />
      )}
      <label class="field">
        <span>账单提醒时间（太平洋时间）</span>
        <select
          value={dunning}
          onChange={(e) => {
            setDunning(Number((e.target as HTMLSelectElement).value));
            setSaved(false);
          }}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {h}:00
            </option>
          ))}
        </select>
        <small class="muted">Finalize 24 小时后每天这时发，直到收齐。</small>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={digest}
          onChange={(e) => {
            setDigest((e.target as HTMLInputElement).checked);
            setSaved(false);
          }}
        />
        每周一发送健康简报
      </label>
      {error && <p class="error">{error}</p>}
      <button type="button" class="button secondary block" disabled={busy} onClick={save}>
        {saved ? "已保存" : "保存"}
      </button>
    </Card>
  );
}
