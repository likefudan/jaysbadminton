import { useState } from "preact/hooks";
import { dollars } from "../../shared/settle";
import { formatInstantZh } from "../../shared/time";
import type { InboundResponse, InboundRow, OpenPayment } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Load, useAction } from "../components";
import { useApi } from "../hooks";

/** Forwarded Venmo payments that carry our code but could not be pinned to one bill. */
export function InboundTab(props: { base: string }) {
  const [data, reload] = useApi<InboundResponse>(`${props.base}/inbound`);
  return (
    <Load result={data}>
      {(d) => (
        <>
          <p class="muted small">
            Venmo 收款邮件自动对账：编号、名字、金额都对上的直接标记已付；金额不对或重复付款的在活动收款看板标为「金额异常」；备注里没有本群付款编号的收款直接忽略，不会出现在这里。
          </p>
          <Card title={`待确认${d.open.length ? ` (${d.open.length})` : ""}`}>
            {d.open.length === 0 && <Empty>没有需要确认的付款</Empty>}
            {d.open.map((i) => (
              <Item key={i.id} base={props.base} item={i} payments={d.payments} onDone={reload} />
            ))}
          </Card>
          {d.done.length > 0 && (
            <Card title="最近处理过的">
              {d.done.map((i) => (
                <div class="inbound" key={i.id}>
                  <Summary item={i} />
                  <small class="muted">
                    {i.state === "ignored"
                      ? "已忽略"
                      : i.linked
                        ? `${i.kind === "anomaly" ? "重复付款，已记入" : "已关联到"} ${i.linked.memberName}（${i.linked.eventLabel}）`
                        : ""}
                  </small>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </Load>
  );
}

function Summary(props: { item: InboundRow }) {
  const i = props.item;
  return (
    <div>
      <strong>{i.payerName ?? "（未知付款人）"}</strong>
      {i.amountCents !== null && <strong> ${dollars(i.amountCents)}</strong>}
      <small class="muted block">
        {formatInstantZh(i.receivedAt)}
        {i.txnId && ` · 交易 ${i.txnId}`}
      </small>
      {i.note && <div class="note">备注：{i.note}</div>}
    </div>
  );
}

function Item(props: { base: string; item: InboundRow; payments: OpenPayment[]; onDone: () => void }) {
  const i = props.item;
  const [target, setTarget] = useState("");
  const { busy, error, run } = useAction();

  async function link() {
    const p = props.payments.find((x) => String(x.id) === target);
    if (!p) return;
    const amount = i.amountCents === null ? "" : ` $${dollars(i.amountCents)}`;
    if (!confirm(`把这笔${amount}算作 ${p.memberName}（${p.eventLabel}）的付款，标记为已付？`)) return;
    if (await run(() => api(`${props.base}/inbound/${i.id}/link`, { paymentId: p.id }))) props.onDone();
  }
  async function ignore() {
    if (!confirm("忽略这笔收款？之后不会再提醒。")) return;
    if (await run(() => api(`${props.base}/inbound/${i.id}/ignore`, {}))) props.onDone();
  }

  return (
    <div class="inbound">
      <Summary item={i} />
      {i.reason && <p class="small reason">{i.reason}</p>}
      {error && <p class="error">{error}</p>}
      <div class="link-row">
        {props.payments.length > 0 && (
          <>
            <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
              <option value="">关联到谁的应付款…</option>
              {props.payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.memberName} · ${dollars(p.amountDueCents)} · {p.eventLabel}
                  {p.status === "anomaly" ? " · 金额异常" : ""}
                </option>
              ))}
            </select>
            <button class="button" disabled={busy || !target} onClick={link}>
              关联
            </button>
          </>
        )}
        <button class="button secondary" disabled={busy} onClick={ignore}>
          忽略
        </button>
      </div>
    </div>
  );
}
