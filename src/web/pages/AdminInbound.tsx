import { useState } from "preact/hooks";
import { dollars } from "../../shared/settle";
import { formatInstantZh } from "../../shared/time";
import type { InboundKind, InboundResponse, InboundRow, OpenPayment } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Load, useAction } from "../components";
import { useApi } from "../hooks";

const KIND_ZH: Record<InboundKind, string> = {
  unmatched: "编号对不上",
  anomaly: "重复付款",
  parse_failed: "邮件读不懂",
  other: "其他收款",
};

/** Forwarded Venmo payments that did not mark a bill by themselves. */
export function InboundTab(props: { base: string }) {
  const [data, reload] = useApi<InboundResponse>(`${props.base}/inbound`);
  return (
    <Load result={data}>
      {(d) => {
        const review = d.open.filter((i) => i.kind !== "other");
        const other = d.open.filter((i) => i.kind === "other");
        return (
          <>
            <p class="muted small">
              Venmo 收款邮件会自动对账：备注里的付款编号对上、金额也对的，直接标记已付，不会出现在这里。金额不对的在活动的收款看板里标为「金额异常」。
            </p>
            <Card title={`待确认${review.length ? ` (${review.length})` : ""}`}>
              {review.length === 0 && <Empty>没有需要确认的付款</Empty>}
              {review.map((i) => (
                <Item key={i.id} base={props.base} item={i} payments={d.payments} onDone={reload} />
              ))}
            </Card>
            <Card title={`其他收款${other.length ? ` (${other.length})` : ""}`}>
              <p class="muted small">备注里没有付款编号的 Venmo 收款，多半和羽毛球无关。是某人的球费就关联过去，否则忽略。</p>
              {other.length === 0 && <Empty>没有</Empty>}
              {other.map((i) => (
                <Item key={i.id} base={props.base} item={i} payments={d.payments} onDone={reload} />
              ))}
            </Card>
            {d.done.length > 0 && (
              <Card title="最近处理过的">
                {d.done.map((i) => (
                  <div class="inbound" key={i.id}>
                    <Summary item={i} />
                    <small class="muted">
                      {i.state === "linked" && i.linked ? `已关联到 ${i.linked.memberName}（${i.linked.eventLabel}）` : "已忽略"}
                    </small>
                  </div>
                ))}
              </Card>
            )}
          </>
        );
      }}
    </Load>
  );
}

function Summary(props: { item: InboundRow }) {
  const i = props.item;
  return (
    <div>
      <strong>{i.payerName ?? "（未知付款人）"}</strong>
      {i.amountCents !== null && <strong> ${dollars(i.amountCents)}</strong>}
      <span class="badge">{KIND_ZH[i.kind]}</span>
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
  const duplicate = i.kind === "anomaly" && i.linked;

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
      {duplicate && (
        <p class="small">
          {i.linked!.memberName}（{i.linked!.eventLabel}）的这笔已经付过了，这是又一笔。退款或另行处理后点「忽略」。
        </p>
      )}
      {i.kind === "unmatched" && <p class="small muted">备注里的编号找不到对应的待付款（活动已归档、编号写错或不是本系统的编号）。</p>}
      {i.kind === "parse_failed" && (
        <details>
          <summary class="small">邮件格式变了，看原文</summary>
          <pre class="raw">{i.rawText}</pre>
        </details>
      )}
      {error && <p class="error">{error}</p>}
      <div class="link-row">
        {!duplicate && props.payments.length > 0 && (
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
