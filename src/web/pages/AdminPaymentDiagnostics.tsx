import { useEffect, useState } from "preact/hooks";
import type { PaymentDiagnosticsResponse, PaymentDiagnosticRecord } from "../../shared/paymentDiagnostics";
import { formatInstantZh } from "../../shared/time";
import { api } from "../api";
import { Card, Empty, Load, useAction } from "../components";
import { useApi } from "../hooks";

const OUTCOMES: Record<string, string> = {
  processing: "处理中（若一直未完成，处理可能中断）",
  processing_error: "处理异常",
  too_large: "邮件过大",
  not_receipt: "不是收款通知",
  bad_signature: "签名验证失败",
  parse_failed: "收款字段解析失败",
  wrong_recipient: "收款账户不匹配",
  duplicate: "重复交易",
  ignored: "已忽略",
  paid: "已付清",
  partial: "部分付款",
  overpaid: "多付，需要退款",
  review: "待确认",
};
const STATUS = { processing: "进行中", passed: "通过", failed: "未通过", warning: "需留意" };

/** All-mail diagnostics stay behind the Owner's own capability (`owner`), including unverified mail. */
export function PaymentDiagnostics(props: { base: string }) {
  const [before, setBefore] = useState<number | null>(null);
  const [data, reload] = useApi<PaymentDiagnosticsResponse>(
    `${props.base}/payment-diagnostics${before ? `?before=${before}` : ""}`,
  );
  const { busy, error, run } = useAction();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (data.state === "ok") setEnabled(data.data.enabled);
  }, [data]);

  async function toggle(on: boolean) {
    const previous = enabled;
    setEnabled(on);
    if (await run(() => api(`${props.base}/payment-diagnostics`, { enabled: on }))) reload();
    else setEnabled(previous);
  }

  return (
    <Card title="付款记录诊断">
      <p class="muted small">
        默认关闭。开启后记录新收到的 Venmo 邮件处理步骤，包括忽略和失败的邮件。记录最多保留 14
        天，关闭后也会自动清理。不会保存完整邮件正文。
      </p>
      <label class="check-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || data.state !== "ok"}
          onChange={(e) => toggle(e.currentTarget.checked)}
        />
        开启付款记录诊断
      </label>
      {error && <p class="error">{error}</p>}
      <Load result={data}>
        {(d) => (
          <>
            <p class="muted small">仅群主可查看。诊断记录本身不代表付款已入账，请查看记录里的入账步骤。</p>
            <button type="button" class="button secondary" onClick={reload}>
              刷新诊断
            </button>
            {before && (
              <button type="button" class="button secondary" onClick={() => setBefore(null)}>
                返回最新记录
              </button>
            )}
            {d.records.length === 0 && (
              <Empty>{d.enabled ? "暂未收到新的 Venmo 邮件" : "暂无记录，开启后开始记录新邮件"}</Empty>
            )}
            {d.records.map((r) => (
              <Diagnostic key={r.id} record={r} />
            ))}
            {d.nextBefore !== null && (
              <button type="button" class="button secondary block" onClick={() => setBefore(d.nextBefore)}>
                查看更早记录
              </button>
            )}
          </>
        )}
      </Load>
    </Card>
  );
}

function Diagnostic(props: { record: PaymentDiagnosticRecord }) {
  const r = props.record;
  const failed = r.steps.find((s) => s.status === "failed");
  return (
    <details class="inbound">
      <summary>
        <strong>
          #{r.id} · {OUTCOMES[r.outcome] ?? r.outcome}
          {r.payerName ? ` · ${r.payerName}` : ""}
        </strong>
        <small class="muted block">
          {formatInstantZh(r.receivedAt)}
          {r.txnId ? ` · 交易 ${r.txnId}` : ""}
        </small>
        {failed && (
          <span class="error block">
            停在：{failed.label}
            {failed.detail ? ` · ${failed.detail}` : ""}
          </span>
        )}
      </summary>
      {r.subject && <p class="small">标题：{r.subject}</p>}
      {r.note !== null && <p class="note">备注：{r.note || "（空）"}</p>}
      <ol class="diagnostic-steps">
        {r.steps.map((s, i) => (
          <li key={`${s.stage}-${i}`}>
            <strong class={s.status === "failed" ? "error" : ""}>
              {s.label} · {STATUS[s.status]}
            </strong>
            {s.detail && <p class="small">{s.detail}</p>}
            {s.actual !== undefined && (
              <p class="small">
                实际：<span class="diagnostic-value">{s.actual || "（空）"}</span>
              </p>
            )}
            {s.expected !== undefined && (
              <p class="small muted">
                期望：<span class="diagnostic-value">{s.expected || "（空）"}</span>
              </p>
            )}
          </li>
        ))}
      </ol>
      <p class="muted small">
        只显示已执行的步骤；提前结束后，后续步骤不会执行。签名失败或未完成验证的邮件内容不可信。
      </p>
    </details>
  );
}
