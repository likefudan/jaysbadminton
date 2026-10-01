import { dollars, venmoLink } from "../shared/settle";
import type { MyPayment } from "../shared/types";
import { CopyButton } from "./components";

const inWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

export function PaymentBox(props: { p: MyPayment }) {
  const p = props.p;
  return (
    <div class="paybox">
      <div class="pay-head">
        <span>本次应付</span>
        <strong class="amount">${dollars(p.amountCents)}</strong>
      </div>
      <ul class="breakdown">
        {p.shares.map((s, i) => (
          <li key={i}>
            <span>
              {s.friendIndex === 0 ? "本人" : s.name}
              {!s.attended && <span class="muted">（未出席）</span>}
            </span>
            <span class="muted">
              场地 ${dollars(s.courtCents)}
              {s.attended && ` + 球 $${dollars(s.shuttleCents)}`}
            </span>
          </li>
        ))}
      </ul>
      {p.status === "paid" && <p class="paid-banner">✓ 已付清，谢谢！</p>}
      {p.status === "anomaly" && <p class="error">付款金额有异常，管理员会和你联系。</p>}
      {p.status === "unpaid" && (
        <>
          {p.venmoUsername ? (
            <a class="button block venmo" href={venmoLink(p.venmoUsername, p.amountCents, p.code)}>
              用 Venmo 付 ${dollars(p.amountCents)}
            </a>
          ) : (
            <p class="muted">管理员还没设置 Venmo 账号。</p>
          )}
          {inWeChat() && <p class="hint">如果在微信里打不开 Venmo，请点右上角「···」，选择「在浏览器中打开」。</p>}
          <div class="manual">
            <p class="small">打不开链接时，可以手动转账：</p>
            <dl>
              {p.venmoUsername && (
                <>
                  <dt>Venmo</dt>
                  <dd>@{p.venmoUsername}</dd>
                </>
              )}
              <dt>金额</dt>
              <dd>${dollars(p.amountCents)}</dd>
              <dt>备注</dt>
              <dd>
                <code>{p.code}</code> <CopyButton text={p.code} label="复制备注" />
              </dd>
            </dl>
            <p class="muted small">备注里一定要带上这个编号，系统才能自动确认你的付款。</p>
            {p.zelleAccount && (
              <p class="muted small">
                也可以用 Zelle 转到 {p.zelleAccount}，但需要管理员手动确认。
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
