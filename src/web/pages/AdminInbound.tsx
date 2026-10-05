import { useState } from "preact/hooks";
import { dollars } from "../../shared/settle";
import { formatInstantZh } from "../../shared/time";
import type { InboundResponse, InboundRow, OpenPayment, Receipt, RefundRow } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, Field, Load, useAction } from "../components";
import { useApi } from "../hooks";

/** Forwarded Venmo payments that carry our code but could not be pinned to one bill. */
export function InboundTab(props: { base: string; owner: boolean }) {
  const [data, reload] = useApi<InboundResponse>(`${props.base}/inbound`);
  return (
    <Load result={data}>
      {(d) => (
        <>
          <p class="muted small">
            Venmo
            收款邮件自动对账：编号和名字对上的自动记到这个人的账上：付够了标记已付，不够的显示「部分付款」等补付，多付的列在「需要退款」里；备注里没有本群付款编号的收款直接忽略，不会出现在这里。
          </p>
          <Refunds base={props.base} list={d.refunds} onDone={reload} />
          <OpenList base={props.base} open={d.open} payments={d.payments} onDone={reload} />
          {(d.ignored ?? []).length > 0 && (
            <Card title={`已忽略 (${d.ignored.length})`}>
              <p class="muted small">忽略错了可以移回待确认，再关联到账单；不需要的可以删除。</p>
              {d.ignored.map((i) => (
                <IgnoredItem key={i.id} base={props.base} item={i} onDone={reload} />
              ))}
            </Card>
          )}
          {d.done.length > 0 && (
            <Card title="最近关联的">
              {d.done.map((i) => (
                <div class="inbound" key={i.id}>
                  <Summary item={i} />
                  {i.linked && (
                    <small class="muted">
                      已关联到 {i.linked.memberName}（{i.linked.eventLabel}）
                    </small>
                  )}
                </div>
              ))}
            </Card>
          )}
          {d.deleted.length > 0 && <Trash base={props.base} list={d.deleted} owner={props.owner} onDone={reload} />}
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
        {/* Set for the Owner only: an organizer's list is all their own account. */}
        {i.payee && ` · 进了 ${i.payee} 的账户`}
      </small>
      {i.note && <div class="note">备注：{i.note}</div>}
    </div>
  );
}

function OpenList(props: { base: string; open: InboundRow[]; payments: OpenPayment[]; onDone: () => void }) {
  const groups = groupPayments(props.payments);
  return (
    <Card title={`待确认${props.open.length ? ` (${props.open.length})` : ""}`}>
      {props.open.length === 0 && <Empty>没有需要确认的付款</Empty>}
      {props.open.map((i) => (
        <Item key={i.id} base={props.base} item={i} groups={groups} onDone={props.onDone} />
      ))}
    </Card>
  );
}

/** Someone who pays twice (a Venmo payment on top of cash, say) can only be put on a paid bill. */
const groupPayments = (payments: OpenPayment[]): [string, OpenPayment[]][] => [
  ["未付清", payments.filter((p) => p.status !== "paid")],
  ["已付清（多付的钱列入需要退款）", payments.filter((p) => p.status === "paid")],
];

function Item(props: { base: string; item: InboundRow; groups: [string, OpenPayment[]][]; onDone: () => void }) {
  const i = props.item;
  const [target, setTarget] = useState("");
  const { busy, error, run } = useAction();

  async function link() {
    const p = props.groups.flatMap(([, list]) => list).find((x) => String(x.id) === target);
    if (!p) return;
    const amount = i.amountCents === null ? "" : ` $${dollars(i.amountCents)}`;
    const what =
      p.status === "paid"
        ? "这笔已经付清，多出的钱会列入「需要退款」。"
        : p.amountPaidCents + (i.amountCents ?? 0) > p.amountDueCents
          ? "多出的钱会列入「需要退款」。"
          : "";
    if (!confirm(`把这笔${amount}算作 ${p.memberName}（${p.eventLabel}）的付款？${what}`)) return;
    if (await run(() => api(`${props.base}/inbound/${i.id}/link`, { paymentId: p.id }))) props.onDone();
  }
  async function ignore() {
    if (!confirm("忽略这笔收款？之后不会再提醒；忽略错了可以在「已忽略」里移回待确认。")) return;
    if (await run(() => api(`${props.base}/inbound/${i.id}/ignore`, {}))) props.onDone();
  }

  return (
    <div class="inbound">
      <Summary item={i} />
      {i.reason && <p class="small reason">{i.reason}</p>}
      {error && <p class="error">{error}</p>}
      <div class="link-row">
        {props.groups.some(([, list]) => list.length > 0) && (
          <>
            <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
              <option value="">关联到谁的应付款…</option>
              {props.groups.map(([label, list]) =>
                list.length === 0 ? null : (
                  <optgroup key={label} label={label}>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.memberName} ·{" "}
                        {p.status === "partial"
                          ? `还差 $${dollars(p.amountDueCents - p.amountPaidCents)}`
                          : p.status === "paid"
                            ? `已付 $${dollars(p.amountPaidCents)}${p.amountPaidCents > p.amountDueCents ? `（应付 $${dollars(p.amountDueCents)}，已多付）` : ""}`
                            : `$${dollars(p.amountDueCents)}`}{" "}
                        · {p.eventLabel}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
            <button type="button" class="button" disabled={busy || !target} onClick={link}>
              关联
            </button>
          </>
        )}
        <button type="button" class="button secondary" disabled={busy} onClick={ignore}>
          忽略
        </button>
        <DeleteButton base={props.base} item={i} onDone={props.onDone} />
      </div>
    </div>
  );
}

/** An ignored payment: 移回待确认 (undoes 忽略) or 删除, sharing one busy state. */
function IgnoredItem(props: { base: string; item: InboundRow; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const act = async (action: "unignore" | "delete") => {
    if (await run(() => api(`${props.base}/inbound/${props.item.id}/${action}`, {}))) props.onDone();
  };
  return (
    <div class="inbound">
      <Summary item={props.item} />
      {props.item.reason && <p class="small reason">{props.item.reason}</p>}
      {error && <p class="error">{error}</p>}
      <div class="link-row">
        <button type="button" class="button secondary" disabled={busy} onClick={() => act("unignore")}>
          移回待确认
        </button>
        <button type="button" class="button secondary" disabled={busy} onClick={() => act("delete")}>
          删除
        </button>
      </div>
    </div>
  );
}

/** Moves a payment to 已删除. No confirmation: it can be restored from there for 30 days. */
function DeleteButton(props: { base: string; item: InboundRow; onDone: () => void }) {
  const { busy, error, run } = useAction();
  async function remove() {
    if (await run(() => api(`${props.base}/inbound/${props.item.id}/delete`, {}))) props.onDone();
  }
  return (
    <>
      <button type="button" class="button secondary" disabled={busy} onClick={remove}>
        删除
      </button>
      {error && <p class="error">{error}</p>}
    </>
  );
}

const TRASH_DAYS = 30;

/**
 * 已删除: restore or delete for good, one at a time; 清空 needs the admin password. Deleting for
 * good is the Owner's alone; an organizer can only restore (it goes away by itself after 30 days).
 */
function Trash(props: { base: string; list: InboundRow[]; owner: boolean; onDone: () => void }) {
  const [clearing, setClearing] = useState(false);
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const what = (i: InboundRow) =>
    `${i.payerName ?? "未知付款人"}${i.amountCents !== null ? ` $${dollars(i.amountCents)}` : ""}`;
  const daysLeft = (i: InboundRow) =>
    Math.max(0, Math.ceil((Date.parse(i.deletedAt ?? "") + TRASH_DAYS * 86400_000 - Date.now()) / 86400_000));

  async function restore(i: InboundRow) {
    if (!confirm(`恢复 ${what(i)} 这笔收款？它会回到原来的列表。`)) return;
    if (await run(() => api(`${props.base}/inbound/${i.id}/restore`, {}))) props.onDone();
  }
  async function purge(i: InboundRow) {
    if (!confirm(`永久删除 ${what(i)} 这笔收款？删除后无法恢复。`)) return;
    if (await run(() => api(`${props.base}/inbound/${i.id}/purge`, {}))) props.onDone();
  }
  async function clear(ev: Event) {
    ev.preventDefault();
    if (!confirm(`永久删除「已删除」里的全部 ${props.list.length} 笔收款？删除后无法恢复。`)) return;
    if (await run(() => api(`${props.base}/inbound/trash/clear`, { password }))) {
      setClearing(false);
      setPassword("");
      props.onDone();
    }
  }

  return (
    <Card title={`已删除 (${props.list.length})`}>
      <p class="muted small">删除的收款保留 {TRASH_DAYS} 天，之后自动永久删除。</p>
      {error && <p class="error">{error}</p>}
      {props.list.map((i) => (
        <div class="inbound" key={i.id}>
          <Summary item={i} />
          <small class="muted">{daysLeft(i)} 天后永久删除</small>
          <div class="link-row">
            <button type="button" class="button secondary" disabled={busy} onClick={() => restore(i)}>
              恢复
            </button>
            {props.owner && (
              <button type="button" class="button danger" disabled={busy} onClick={() => purge(i)}>
                永久删除
              </button>
            )}
          </div>
        </div>
      ))}
      {!props.owner ? null : !clearing ? (
        <button type="button" class="button danger block" disabled={busy} onClick={() => setClearing(true)}>
          清空
        </button>
      ) : (
        <form onSubmit={clear}>
          <Field
            label="群主密码"
            type="password"
            value={password}
            onInput={setPassword}
            autocomplete="current-password"
          />
          <button type="submit" class="button danger block" disabled={busy || !password}>
            永久删除全部 {props.list.length} 笔
          </button>
          <button class="button secondary block" type="button" onClick={() => setClearing(false)}>
            取消
          </button>
        </form>
      )}
    </Card>
  );
}

/** Over-payments to send back: what was due, every payment received, and the difference. */
function Refunds(props: { base: string; list: RefundRow[]; onDone: () => void }) {
  const { busy, error, run } = useAction();
  async function done(r: RefundRow) {
    if (!confirm(`已经把 $${dollars(r.refundCents)} 退给 ${r.memberName} 了？`)) return;
    if (await run(() => api(`${props.base}/payments/${r.paymentId}/refunded`, {}))) props.onDone();
  }
  if (props.list.length === 0) return null;
  return (
    <Card title={`需要退款 (${props.list.length})`}>
      {error && <p class="error">{error}</p>}
      {props.list.map((r) => (
        <div class="inbound" key={r.paymentId}>
          <div>
            <strong>{r.memberName}</strong> 需退 <strong class="refund">${dollars(r.refundCents)}</strong>
            <small class="muted block">
              {r.eventLabel} · 应付 ${dollars(r.amountDueCents)} · 共收到 ${dollars(r.amountPaidCents)}
            </small>
          </div>
          <ReceiptList receipts={r.receipts} />
          <div class="link-row">
            <button type="button" class="button" disabled={busy} onClick={() => done(r)}>
              已退款
            </button>
          </div>
        </div>
      ))}
    </Card>
  );
}

export function ReceiptList(props: {
  receipts: Receipt[];
  onRemove?: (r: Receipt) => void;
  /** Which receipts get 撤销; all of them when left out. */
  canRemove?: (r: Receipt) => boolean;
  busy?: boolean;
}) {
  if (props.receipts.length === 0) return null;
  return (
    <ul class="receipts">
      {props.receipts.map((r, i) => (
        <li key={r.id}>
          <span>
            第 {i + 1} 笔 ·{" "}
            {r.method === "venmo"
              ? `Venmo${r.payerName ? `（${r.payerName}）` : ""}`
              : r.method === "refund"
                ? "退款"
                : "手动标记"}{" "}
            · {formatInstantZh(r.receivedAt)}
            {r.elsewhere && ` · 钱在 ${r.elsewhere} 的账户`}
          </span>
          <span>
            {r.amountCents < 0 ? `−$${dollars(-r.amountCents)}` : `$${dollars(r.amountCents)}`}
            {props.onRemove && (props.canRemove?.(r) ?? true) && (
              <button type="button" class="undo" disabled={props.busy} onClick={() => props.onRemove!(r)}>
                撤销
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
