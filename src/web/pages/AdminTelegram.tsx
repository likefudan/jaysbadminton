import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { Card, Field, Load, useAction } from "../components";
import { useApi } from "../hooks";

interface TelegramStatus {
  botReady: boolean;
  botUsername: string;
  connected: boolean;
  chatName: string;
}

/** Connects the Owner's Telegram with a one-time link, and sends a test message. */
export function TelegramCard(props: { base: string }) {
  const [status, reload] = useApi<TelegramStatus>(`${props.base}/telegram`);
  const [waiting, setWaiting] = useState(false);
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState(false);

  // After opening Telegram, check every few seconds until Start has been tapped (up to 3 minutes).
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const t = setInterval(async () => {
      const s = await api<TelegramStatus>(`${props.base}/telegram`).catch(() => null);
      if (s?.connected || Date.now() - started > 180_000) {
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
    if (!confirm("断开后不再收到任何通知。继续吗？")) return;
    if (await run(() => api(`${props.base}/telegram/disconnect`, {}))) reload();
  }

  return (
    <Card title="Telegram 通知">
      <Load result={status}>
        {(s) =>
          !s.botReady ? (
            <p class="muted">还没有配置机器人。请网站维护者在 GitHub secret 里加上 TELEGRAM_BOT_TOKEN 并重新部署。</p>
          ) : (
            <>
              {s.connected ? (
                <p>
                  ✓ 已连接：<strong>{s.chatName}</strong>
                  {s.botUsername && <span class="muted small">（机器人 @{s.botUsername}）</span>}
                </p>
              ) : (
                <p class="muted">
                  还没有连接。点下面的按钮会打开 Telegram，在机器人对话里点「Start /
                  开始」即可。所有提醒和账单通知只发给连接的这一个账号。
                </p>
              )}
              {waiting && <p class="hint">等待你在 Telegram 里点 Start…（3 分钟内有效）</p>}
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
            </>
          )
        }
      </Load>
    </Card>
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
        <small class="muted">Finalize 满 24 小时后，每天这个时间发一次收款汇总和每个人的账单提醒，直到收齐。</small>
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
      <p class="muted small">
        简报在账单提醒时间发送：上周收到多少 Venmo 邮件、自动记了几笔、还有多少没付清，以及邮件转发、定时任务、Google
        表格同步是否正常。另外，Venmo 邮件读不懂、或者有欠款却好几天没收到任何 Venmo 邮件时，会立即提醒你。
      </p>
      {error && <p class="error">{error}</p>}
      <button type="button" class="button secondary block" disabled={busy} onClick={save}>
        {saved ? "已保存" : "保存"}
      </button>
    </Card>
  );
}
