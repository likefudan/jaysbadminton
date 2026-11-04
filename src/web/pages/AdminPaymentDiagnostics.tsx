import { useEffect, useState } from "preact/hooks";
import type { PaymentDiagnosticsResponse, PaymentDiagnosticRecord } from "../../shared/paymentDiagnostics";
import { api } from "../api";
import { Card, Empty, Load, useAction } from "../components";
import { useApi } from "../hooks";
import { t, tk, tx, fmtInstant } from "../i18n";

const OUTCOMES: Record<string, string> = {
  processing: tk("处理中（若一直未完成，处理可能中断）"),
  processing_error: tk("处理异常"),
  too_large: tk("邮件过大"),
  not_receipt: tk("不是收款通知"),
  bad_signature: tk("签名验证失败"),
  parse_failed: tk("收款字段解析失败"),
  wrong_recipient: tk("收款账户不匹配"),
  duplicate: tk("重复交易"),
  ignored: tk("已忽略"),
  paid: tk("已付清"),
  partial: tk("部分付款"),
  overpaid: tk("多付，需要退款"),
  review: tk("待确认"),
};
const STATUS = { processing: tk("进行中"), passed: tk("通过"), failed: tk("未通过"), warning: tk("需留意") };

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
    <Card title={t("付款记录诊断")}>
      <p class="muted small">
        {t(
          "默认关闭。开启后记录新收到的 Venmo 邮件处理步骤，包括忽略和失败的邮件。记录最多保留 14 天，关闭后也会自动清理。不会保存完整邮件正文。",
        )}
      </p>
      <label class="check-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || data.state !== "ok"}
          onChange={(e) => toggle(e.currentTarget.checked)}
        />
        {t("开启付款记录诊断")}
      </label>
      {error && <p class="error">{error}</p>}
      <Load result={data}>
        {(d) => (
          <>
            <p class="muted small">{t("仅群主可查看。诊断记录本身不代表付款已入账，请查看记录里的入账步骤。")}</p>
            <button type="button" class="button secondary" onClick={reload}>
              {t("刷新诊断")}
            </button>
            {before && (
              <button type="button" class="button secondary" onClick={() => setBefore(null)}>
                {t("返回最新记录")}
              </button>
            )}
            {d.records.length === 0 && (
              <Empty>{d.enabled ? t("暂未收到新的 Venmo 邮件") : t("暂无记录，开启后开始记录新邮件")}</Empty>
            )}
            {d.records.map((r) => (
              <Diagnostic key={r.id} record={r} />
            ))}
            {d.nextBefore !== null && (
              <button type="button" class="button secondary block" onClick={() => setBefore(d.nextBefore)}>
                {t("查看更早记录")}
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
          #{r.id} · {OUTCOMES[r.outcome] ? t(OUTCOMES[r.outcome]!) : r.outcome}
          {r.payerName ? ` · ${r.payerName}` : ""}
        </strong>
        <small class="muted block">
          {fmtInstant(r.receivedAt)}
          {r.txnId ? t(" · 交易 {txnId}", { txnId: r.txnId }) : ""}
        </small>
        {failed && (
          <span class="error block">
            {tx("停在：{x}{x2}", { x: failed.label, x2: failed.detail ? ` · ${failed.detail}` : "" })}
          </span>
        )}
      </summary>
      {r.subject && <p class="small">{t("标题：{subject}", { subject: r.subject })}</p>}
      {r.note !== null && <p class="note">{t("备注：{note}", { note: r.note || t("（空）") })}</p>}
      <ol class="diagnostic-steps">
        {r.steps.map((s, i) => (
          <li key={`${s.stage}-${i}`}>
            <strong class={s.status === "failed" ? "error" : ""}>
              {s.label} · {t(STATUS[s.status])}
            </strong>
            {s.detail && <p class="small">{s.detail}</p>}
            {s.actual !== undefined && (
              <p class="small">
                {tx("实际：{value}", { value: <span class="diagnostic-value">{s.actual || t("（空）")}</span> })}
              </p>
            )}
            {s.expected !== undefined && (
              <p class="small muted">
                {tx("期望：{value}", { value: <span class="diagnostic-value">{s.expected || t("（空）")}</span> })}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p class="muted small">
        {t("只显示已执行的步骤；提前结束后，后续步骤不会执行。签名失败或未完成验证的邮件内容不可信。")}
      </p>
    </details>
  );
}
