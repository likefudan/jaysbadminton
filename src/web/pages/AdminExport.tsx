import { useState } from "preact/hooks";
import { formatInstantZh } from "../../shared/time";
import { api } from "../api";
import { Card, CopyButton, Load, useAction } from "../components";
import { useApi } from "../hooks";

const FILES = [
  ["events", "活动"],
  ["registrations", "报名"],
  ["settlements", "结算"],
  ["payments", "应付款"],
  ["receipts", "付款明细"],
  ["members", "成员"],
  ["inbound", "待确认收款"],
  ["locations", "场馆"],
] as const;

/** CSV downloads, available any time. */
export function ExportCard(props: { base: string }) {
  return (
    <Card title="导出数据">
      <p class="muted small">金额为美元，时间为太平洋时间。</p>
      <div class="downloads">
        {FILES.map(([name, label]) => (
          <a key={name} class="button secondary" href={`${props.base}/export/${name}.csv`} download>
            {label}
          </a>
        ))}
      </div>
    </Card>
  );
}

interface SheetsState {
  enabled: boolean;
  lastSyncAt: string | null;
  script: string | null;
  /** On, but the key can't be shown any more (the site's key was replaced): make a new one. */
  keyLost: boolean;
}

/**
 * Google 表格同步: the sheet pulls from the site daily with a script the Owner pastes once. Admins
 * (`readOnly`) see whether it runs, not the script (it holds the export key) or the switches.
 */
export function SheetsCard(props: { base: string; readOnly?: boolean }) {
  const [state, reload] = useApi<SheetsState>(`${props.base}/sheets`);
  const [script, setScript] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  async function enable(rotate: boolean) {
    if (rotate && !confirm("重新生成后，旧脚本立即失效，需要把新脚本粘贴到 Google 表格里。继续吗？")) return;
    const r = await run(() => api<{ script: string }>(`${props.base}/sheets/enable`, {}));
    if (r) {
      setScript(r.script);
      reload();
    }
  }
  async function disable() {
    if (!confirm("关闭后，Google 表格将无法再同步（表格里已有的数据保留）。继续吗？")) return;
    if (await run(() => api(`${props.base}/sheets/disable`, {}))) {
      setScript(null);
      reload();
    }
  }

  return (
    <Card title="Google 表格同步">
      <Load result={state}>
        {(s) => {
          const code = script ?? s.script;
          if (props.readOnly) {
            return (
              <>
                <p class="small">
                  {!s.enabled
                    ? "没有开启。"
                    : s.lastSyncAt
                      ? `✓ 已开启，上次同步：${formatInstantZh(s.lastSyncAt)}`
                      : "已开启，还没有同步过。"}
                </p>
                {s.enabled && s.keyLost && <p class="error">网站密钥换过，需要群主重新生成同步脚本。</p>}
                <p class="muted small">开启、关闭同步和查看脚本只有群主能做。</p>
              </>
            );
          }
          if (!s.enabled) {
            return (
              <>
                <p class="muted small">
                  每天自动把所有数据（活动、报名、结算、付款、成员等）复制一份到你自己的 Google
                  表格，作为备份和存档。网站不需要你的 Google 账号；表格只读取，不会改动网站的数据。
                </p>
                {error && <p class="error">{error}</p>}
                <button type="button" class="button block" disabled={busy} onClick={() => enable(false)}>
                  开启同步
                </button>
              </>
            );
          }
          return (
            <>
              {s.keyLost && !script && (
                <p class="error">
                  网站密钥换过，同步脚本已无法显示。请点下面的「重新生成密钥」，再把新脚本粘贴到 Google
                  表格里（旧脚本在那之前还能继续同步）。
                </p>
              )}
              <p class="small">
                {s.lastSyncAt
                  ? `✓ 上次同步：${formatInstantZh(s.lastSyncAt)}`
                  : "还没有同步过。按下面的步骤设置好后会自动同步。"}
              </p>
              <ol class="steps">
                <li>新建一个 Google 表格（sheets.new）。</li>
                <li>菜单「扩展程序」→「Apps Script」，删掉里面原有的内容。</li>
                <li>复制下面的脚本，粘贴进去，点保存。</li>
                <li>
                  在顶部选择函数 <code>install</code>，点「运行」，按提示授权。看到「Google
                  尚未验证此应用」时，点「高级」→「转到…（不安全）」→「允许」。
                </li>
                <li>完成后表格里会出现各个标签页，以后每天凌晨 3 点自动更新。</li>
              </ol>
              {code && (
                <>
                  <pre class="script">{code}</pre>
                  <div class="copy-block">
                    <CopyButton text={code} label="复制脚本" />
                  </div>
                </>
              )}
              <p class="muted small">
                脚本里含有同步密钥，请不要发给别人。万一泄露，点「重新生成密钥」后粘贴新脚本即可。
              </p>
              {error && <p class="error">{error}</p>}
              <button type="button" class="button secondary block" disabled={busy} onClick={() => enable(true)}>
                重新生成密钥
              </button>
              <button type="button" class="link-button" disabled={busy} onClick={disable}>
                关闭同步
              </button>
            </>
          );
        }}
      </Load>
    </Card>
  );
}
