import { useState } from "preact/hooks";
import { dollars, parseDollars, type Settlement, usd } from "../../shared/settle";
import type { EventDetail, PaymentRow, Receipt, SettlementView } from "../../shared/types";
import { ReceiptList } from "./AdminInbound";
import { api } from "../api";
import { Card, Empty, Field, Load, useAction } from "../components";
import { useApi } from "../hooks";
import { t, tx } from "../i18n";

/** Fee inputs, live preview and Finalize. After Finalize the same form saves changes. */
/** "$13.33", or "$13.33（1 份 $13.34）" when some shares carry a leftover cent. */
const perShare = (cents: number, extra: number) =>
  `$${dollars(cents)}${extra > 0 ? t("（{n} 份 {amount}）", { n: extra, amount: usd(cents + 1) }) : ""}`;

export function SettleCard(props: { base: string; e: EventDetail; view: SettlementView; onDone: () => void }) {
  const eb = `${props.base}/events/${props.e.id}`;
  const v = props.view;
  const finalized = props.e.status === "finalized";
  const [court, setCourt] = useState(v.inputs?.courtTotal ?? "");
  const [count, setCount] = useState(String(v.inputs?.shuttleCount ?? ""));
  const [price, setPrice] = useState(v.inputs?.shuttlePrice ?? v.defaultShuttlePrice);
  const [preview, setPreview] = useState<Settlement | null>(null);
  const { busy, error, run } = useAction();
  const body = () => ({ courtTotal: court, shuttleCount: Number(count), shuttlePrice: price });

  async function doPreview() {
    const r = await run(() => api<Settlement>(`${eb}/preview`, body()));
    if (r) setPreview(r);
  }
  // Nobody marked as attended: the shuttle cost has nobody to split it, so it is quietly dropped.
  // Read from the roster, which reloads when attendance changes (a preview can be out of date).
  const noShuttleShare =
    props.e.roster.length > 0 &&
    props.e.roster.every((r) => !r.attended) &&
    Number(count) > 0 &&
    (parseDollars(price) ?? 0) > 0;
  async function doFinalize() {
    const msg =
      (noShuttleShare ? t("所有人都标成了未出席，球费不会算进任何人的账单。\n") : "") +
      (finalized
        ? t("保存后，所有人的金额都会按新数据重新计算；已付款的人会显示还差多少或多付多少。继续吗？")
        : t("Finalize 后，成员就能看到应付金额和付款链接。确定吗？"));
    if (!confirm(msg)) return;
    if (await run(() => api(`${eb}/finalize`, body()))) {
      setPreview(null);
      props.onDone();
    }
  }

  const names = new Map(props.e.roster.map((r) => [r.memberId, r.memberName]));
  return (
    <Card title={finalized ? t("费用（已 Finalize，可修改）") : t("结算")}>
      <Field label={t("场地总费用（美元）")} type="text" value={court} onInput={setCourt} />
      <div class="inline">
        <Field label={t("用球个数")} type="number" value={count} onInput={setCount} />
        <Field label={t("球单价（美元）")} type="text" value={price} onInput={setPrice} />
      </div>
      {error && <p class="error">{error}</p>}
      <button type="button" class="button secondary block" disabled={busy} onClick={doPreview}>
        {t("预览每人金额")}
      </button>
      {preview && (
        <>
          <p class="small">
            {tx("报名 {x} 人 · 到场 {x2} 人 · 每人场地费 {x3} · 每人球费 {x4}", {
              x: preview.registered,
              x2: preview.attended,
              x3: perShare(preview.courtShareCents, preview.courtExtraShares),
              x4: perShare(preview.shuttleShareCents, preview.shuttleExtraShares),
            })}
          </p>
          <table class="bills">
            <tbody>
              {preview.bills.map((b) => (
                <tr key={b.memberId}>
                  <td>
                    {names.get(b.memberId)}
                    {b.shares.length > 1 && (
                      <span class="muted small">{t("（含 {n} 个朋友）", { n: b.shares.length - 1 })}</span>
                    )}
                  </td>
                  <td>${dollars(b.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="small">{t("合计应收 {amount}", { amount: usd(preview.totalCents) })}</p>
          {noShuttleShare && <p class="error">{t("所有人都标成了未出席，球费不会算进任何人的账单。")}</p>}
          <button type="button" class="button block" disabled={busy} onClick={doFinalize}>
            {finalized ? t("保存修改") : "Finalize"}
          </button>
        </>
      )}
    </Card>
  );
}

export function PaymentsBoard(props: { base: string; e: EventDetail; view: SettlementView; onDone: () => void }) {
  const v = props.view;
  const { busy, error, run } = useAction();
  const settled = props.e.status === "settled";

  async function mark(p: PaymentRow) {
    const owed = p.amountDueCents - p.amountPaidCents;
    if (
      !confirm(
        t("确认收到 {memberName} 的 {dollars}（现金、Zelle 等），标记已付清？", {
          memberName: p.memberName,
          dollars: usd(owed),
        }),
      )
    )
      return;
    if (await run(() => api(`${props.base}/payments/${p.id}/mark-paid`, {}))) props.onDone();
  }
  async function remove(p: PaymentRow, r: Receipt) {
    const what =
      r.amountCents < 0 ? t("退款 {dollars}", { dollars: usd(-r.amountCents) }) : `$${dollars(r.amountCents)}`;
    const back = r.method === "venmo" ? t("这笔 Venmo 付款会回到待确认，可以再关联到正确的账单。") : "";
    if (!confirm(t("撤销 {memberName} 的这笔{what}？{back}", { memberName: p.memberName, what, back }))) return;
    if (await run(() => api(`${props.base}/receipts/${r.id}/remove`, {}))) props.onDone();
  }

  async function toggleDunning() {
    const stop = !props.e.dunningStopped;
    if (stop && !confirm(t("停止后不再发送这个活动的每日收款汇总和账单提醒，但未付记录保留、活动不归档。继续吗？")))
      return;
    if (await run(() => api(`${props.base}/events/${props.e.id}/dunning`, { stop }))) props.onDone();
  }

  return (
    <>
      {settled && <div class="collected">{t("✓ 已收齐，活动已归档")}</div>}
      <Card title={t("收款看板")}>
        <div class="totals">
          <div>
            <small class="muted">{t("应收")}</small>
            <strong>${dollars(v.totals.dueCents)}</strong>
          </div>
          <div>
            <small class="muted">{t("已收")}</small>
            <strong>${dollars(v.totals.paidCents)}</strong>
          </div>
          <div>
            <small class="muted">{t("未付")}</small>
            <strong>{t("{n} 人", { n: v.totals.unpaidCount })}</strong>
          </div>
        </div>
        {error && <p class="error">{error}</p>}
        {v.payments.length === 0 && <Empty>{t("没有应付款")}</Empty>}
        {v.payments.map((p) => (
          <div class="pay-row" key={p.id}>
            <div class="row">
              <div class="who">
                <div class="pay-name">
                  <span>
                    {p.memberName}
                    {p.isPayee && <span class="badge">{v.payeeIsMe ? t("我") : t("收款人")}</span>}
                  </span>
                  <span class={`pay-status ${p.status}`}>
                    {p.status === "paid"
                      ? t("✓ 已付 {dollars}", { dollars: usd(p.amountDueCents) })
                      : p.status === "partial"
                        ? t("部分付款 {dollars} / {dollars2}", {
                            dollars: usd(p.amountPaidCents),
                            dollars2: usd(p.amountDueCents),
                          })
                        : t("未付 {dollars}", { dollars: usd(p.amountDueCents) })}
                  </span>
                </div>
                <small>{p.paymentCode}</small>
                {p.status === "partial" && (
                  <small class="refund">
                    {t("还差 {amount}", { amount: usd(p.amountDueCents - p.amountPaidCents) })}
                  </small>
                )}
                {p.status === "paid" && p.refundCents > 0 && (
                  <small class="refund">{t("多付 {amount}，需要退款", { amount: usd(p.refundCents) })}</small>
                )}
              </div>
              {!settled && !p.isPayee && p.status !== "paid" && (
                <div class="actions">
                  <button type="button" class="button" disabled={busy} onClick={() => mark(p)}>
                    {p.status === "partial" ? t("补齐已付") : t("标记已付")}
                  </button>
                </div>
              )}
            </div>
            {!p.isPayee && (
              <ReceiptList
                receipts={p.receipts}
                busy={busy}
                onRemove={(r) => remove(p, r)}
                // Archived: only an extra Venmo payment can come off, so the bill stays paid.
                canRemove={
                  settled
                    ? (r) => r.method === "venmo" && p.amountPaidCents - r.amountCents >= p.amountDueCents
                    : undefined
                }
              />
            )}
          </div>
        ))}
        {!settled && v.totals.unpaidCount > 0 && (
          <button type="button" class="link-button" disabled={busy} onClick={toggleDunning}>
            {props.e.dunningStopped ? t("已停止账单提醒 · 点此恢复") : t("停止账单提醒")}
          </button>
        )}
      </Card>
    </>
  );
}

/** Loads the settlement view and shows whichever of the two cards fits the event's status. */
export function Billing(props: { base: string; e: EventDetail; onChange: () => void }) {
  const [view, reload] = useApi<SettlementView>(
    `${props.base}/events/${props.e.id}/settlement?v=${props.e.status}-${props.e.headcount}`,
  );
  const refresh = () => {
    reload();
    props.onChange();
  };
  const s = props.e.status;
  if (s === "open" || s === "cancelled") return null;
  return (
    <Load result={view}>
      {(v) => (
        <>
          {(s === "finalized" || s === "settled") && (
            <PaymentsBoard base={props.base} e={props.e} view={v} onDone={refresh} />
          )}
          {(s === "closed" || s === "finalized") && (
            <SettleCard base={props.base} e={props.e} view={v} onDone={refresh} />
          )}
        </>
      )}
    </Load>
  );
}
