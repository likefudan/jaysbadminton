import type { PaymentDiagnosticStep, PaymentDiagnosticsResponse } from "../shared/paymentDiagnostics";
import { getSettings, now } from "./db";
import { splitMessage } from "./email/dkim";
import type { ParsedEmail } from "./email/parse";
import type { Env } from "./env";

export const DIAGNOSTIC_DAYS = 14;
export const DIAGNOSTIC_SETTING = "payment_diagnostics_enabled";
const limit = (s: string, max = 1000) => s.slice(0, max);
const cutoff = (at: Date) => new Date(at.getTime() - DIAGNOSTIC_DAYS * 86400_000).toISOString();

export async function diagnosticsEnabled(env: Env): Promise<boolean> {
  return (await getSettings(env.DB, [DIAGNOSTIC_SETTING]))[DIAGNOSTIC_SETTING] === "1";
}

/** Diagnostic storage must never stop or roll back normal payment processing. */
export class PaymentDiagnostic {
  private steps: PaymentDiagnosticStep[] = [];
  private subject = "";
  private txnId: string | null = null;
  private payer: string | null = null;
  private note: string | null = null;

  constructor(
    private env: Env,
    readonly id: number,
  ) {}

  mail(mail: ParsedEmail) {
    this.subject = limit(mail.subject, 300);
    this.txnId = mail.receipt ? limit(mail.receipt.txnId, 200) : null;
    this.payer = mail.receipt ? limit(mail.receipt.payer, 100) : null;
    this.note = mail.receipt ? limit(mail.receipt.note) : null;
  }

  step(
    stage: string,
    label: string,
    status: PaymentDiagnosticStep["status"],
    detail?: string,
    actual?: string,
    expected?: string,
  ) {
    const step: PaymentDiagnosticStep = { stage, label, status };
    if (detail) step.detail = limit(detail);
    if (actual !== undefined) step.actual = limit(actual);
    if (expected !== undefined) step.expected = limit(expected);
    let pending = -1;
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i]!.stage === stage && this.steps[i]!.status === "processing") {
        pending = i;
        break;
      }
    }
    if (pending >= 0) this.steps[pending] = step;
    else if (this.steps.length < 40) this.steps.push(step);
  }

  error() {
    const last = [...this.steps].reverse().find((s) => s.status === "processing");
    this.step(
      last?.status === "processing" ? last.stage : "processing_error",
      last?.status === "processing" ? last.label : "处理异常",
      "failed",
      `处理发生异常，请按诊断编号 ${this.id} 和接收时间查看 Worker 日志。未自动重试。`,
    );
  }

  async finish(outcome: string) {
    try {
      await this.env.DB.prepare(
        `UPDATE payment_diagnostics SET outcome = ?, subject = ?, txn_id = ?, payer_name = ?, note = ?, steps_json = ? WHERE id = ?`,
      )
        .bind(outcome, this.subject, this.txnId, this.payer, this.note, JSON.stringify(this.steps), this.id)
        .run();
    } catch (err) {
      console.error("payment diagnostic save failed:", this.id, err);
    }
  }

  async discard() {
    try {
      await this.env.DB.prepare("DELETE FROM payment_diagnostics WHERE id = ?").bind(this.id).run();
    } catch (err) {
      console.error("payment diagnostic discard failed:", this.id, err);
    }
  }
}

export async function beginVenmoDiagnostic(env: Env, raw: Uint8Array): Promise<PaymentDiagnostic | null> {
  // Identify claimed Venmo mail even when MIME parsing fails. The normal From and DKIM checks
  // still decide whether it is trustworthy. No raw headers or body are retained.
  const from = splitMessage(raw.subarray(0, 512 * 1024)).headers.filter((h) => h.name === "from");
  if (!from.some((h) => /(?:<|\s|:)venmo@venmo\.com(?:>|\s|$)/i.test(h.raw))) return null;
  return beginClaimedVenmoDiagnostic(env);
}

export async function beginClaimedVenmoDiagnostic(env: Env): Promise<PaymentDiagnostic | null> {
  try {
    if (!(await diagnosticsEnabled(env))) return null;
    const row = await env.DB.prepare(
      "INSERT INTO payment_diagnostics (received_at, outcome) VALUES (?, 'processing') RETURNING id",
    )
      .bind(now())
      .first<{ id: number }>();
    return row ? new PaymentDiagnostic(env, row.id) : null;
  } catch (err) {
    console.error("payment diagnostic start failed:", err);
    return null;
  }
}

export async function diagnoseOversizedEmail(env: Env, from: string) {
  if (!/(?:^|<|\s|:)venmo@venmo\.com(?:>|\s|$)/i.test(from)) return;
  const d = await beginClaimedVenmoDiagnostic(env);
  d?.step("size", "邮件大小", "failed", "邮件超过 512 KB，未读取正文。发送方尚未验证。");
  await d?.finish("too_large");
}

export async function purgePaymentDiagnostics(env: Env, at = new Date()): Promise<void> {
  await env.DB.prepare("DELETE FROM payment_diagnostics WHERE received_at < ?").bind(cutoff(at)).run();
}

export async function paymentDiagnostics(env: Env, before?: number): Promise<PaymentDiagnosticsResponse> {
  await purgePaymentDiagnostics(env);
  const { results } = await env.DB.prepare(
    `SELECT * FROM payment_diagnostics WHERE received_at >= ? AND id < ? ORDER BY id DESC LIMIT 51`,
  )
    .bind(cutoff(new Date()), before ?? Number.MAX_SAFE_INTEGER)
    .all<{
      id: number;
      received_at: string;
      outcome: string;
      subject: string;
      txn_id: string | null;
      payer_name: string | null;
      note: string | null;
      steps_json: string;
    }>();
  const shown = results.slice(0, 50);
  return {
    enabled: await diagnosticsEnabled(env),
    records: shown.map((r) => ({
      id: r.id,
      receivedAt: r.received_at,
      outcome: r.outcome,
      subject: r.subject,
      txnId: r.txn_id,
      payerName: r.payer_name,
      note: r.note,
      steps: JSON.parse(r.steps_json),
    })),
    nextBefore: results.length > 50 ? shown.at(-1)!.id : null,
  };
}
