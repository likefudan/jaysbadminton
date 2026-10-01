import { useState } from "preact/hooks";
import { dollars, type Settlement } from "../../shared/settle";
import type { EventDetail, PaymentRow, SettlementView } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, Load, useAction } from "../components";
import { useApi } from "../hooks";

/** Fee inputs, live preview and Finalize. After Finalize the same form saves changes. */
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
  async function doFinalize() {
    const msg = finalized
      ? "保存后，未付款的人金额会按新数据重新计算；已付款的人不变。继续吗？"
      : "Finalize 后，成员就能看到应付金额和付款链接。确定吗？";
    if (!confirm(msg)) return;
    if (await run(() => api(`${eb}/finalize`, body()))) {
      setPreview(null);
      props.onDone();
    }
  }

  const names = new Map(props.e.roster.map((r) => [r.memberId, r.memberName]));
  return (
    <Card title={finalized ? "费用（已 Finalize，可修改）" : "结算"}>
      <p class="muted small">先在上面的名单里把没来的人标成「未出席」。</p>
      <Field label="场地总费用（美元）" type="text" value={court} onInput={setCourt} />
      <div class="inline">
        <Field label="用球个数" type="number" value={count} onInput={setCount} />
        <Field label="球单价（美元）" type="text" value={price} onInput={setPrice} />
      </div>
      {error && <p class="error">{error}</p>}
      <button class="button secondary block" disabled={busy} onClick={doPreview}>
        预览每人金额
      </button>
      {preview && (
        <>
          <p class="small">
            报名 {preview.registered} 人 · 到场 {preview.attended} 人 · 每人场地费 ${dollars(preview.courtShareCents)} · 每人球费 $
            {dollars(preview.shuttleShareCents)}
          </p>
          <table class="bills">
            <tbody>
              {preview.bills.map((b) => (
                <tr key={b.memberId}>
                  <td>
                    {names.get(b.memberId)}
                    {b.shares.length > 1 && <span class="muted small">（含 {b.shares.length - 1} 个朋友）</span>}
                  </td>
                  <td>${dollars(b.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="small">合计应收 ${dollars(preview.totalCents)}</p>
          <button class="button block" disabled={busy} onClick={doFinalize}>
            {finalized ? "保存修改" : "Finalize"}
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

  async function mark(p: PaymentRow, paid: boolean) {
    const q = paid ? `确认 ${p.memberName} 已付清 $${dollars(p.amountDueCents)}？` : `撤销 ${p.memberName} 的已付标记？`;
    if (!confirm(q)) return;
    if (await run(() => api(`${props.base}/payments/${p.id}/${paid ? "mark-paid" : "unmark"}`, {}))) props.onDone();
  }

  return (
    <>
      {settled && <div class="collected">✓ 已收齐，活动已归档</div>}
      <Card title="收款看板">
        <div class="totals">
          <div>
            <small class="muted">应收</small>
            <strong>${dollars(v.totals.dueCents)}</strong>
          </div>
          <div>
            <small class="muted">已收</small>
            <strong>${dollars(v.totals.paidCents)}</strong>
          </div>
          <div>
            <small class="muted">未付</small>
            <strong>{v.totals.unpaidCount} 人</strong>
          </div>
        </div>
        {error && <p class="error">{error}</p>}
        {v.payments.length === 0 && <Empty>没有应付款</Empty>}
        {v.payments.map((p) => (
          <div class="row" key={p.id}>
            <div class="who">
              {p.memberName}
              {p.isOwner && <span class="badge">我</span>}
              <small>
                ${dollars(p.amountDueCents)} · {p.paymentCode}
                {p.status === "paid" && ` · 已付${p.method === "venmo_auto" ? "（Venmo 自动）" : ""}`}
                {p.status === "anomaly" && " · 金额异常"}
              </small>
            </div>
            {!settled && !p.isOwner && (
              <div class="actions">
                {p.status !== "paid" ? (
                  <button class="button" disabled={busy} onClick={() => mark(p, true)}>
                    标记已付
                  </button>
                ) : (
                  <button class="button secondary" disabled={busy} onClick={() => mark(p, false)}>
                    撤销
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

/** Loads the settlement view and shows whichever of the two cards fits the event's status. */
export function Billing(props: { base: string; e: EventDetail; onChange: () => void }) {
  const [view, reload] = useApi<SettlementView>(`${props.base}/events/${props.e.id}/settlement?v=${props.e.status}-${props.e.headcount}`);
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
          {(s === "finalized" || s === "settled") && <PaymentsBoard base={props.base} e={props.e} view={v} onDone={refresh} />}
          {(s === "closed" || s === "finalized") && <SettleCard base={props.base} e={props.e} view={v} onDone={refresh} />}
        </>
      )}
    </Load>
  );
}
