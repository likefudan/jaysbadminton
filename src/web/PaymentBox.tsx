import { dollars, venmoLink } from "../shared/settle";
import type { MyPayment } from "../shared/types";
import { CopyButton } from "./components";

const inWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

export function PaymentBox(props: { p: MyPayment }) {
  const p = props.p;
  const owed = p.amountCents - p.paidCents; // what the Venmo button asks for after a partial payment
  return (
    <div class="paybox">
      <p class="pay-label">本次应付</p>
      <p class="amount">${dollars(p.amountCents)}</p>
      <ul class="breakdown">
        {p.shares.map((s, i) => (
          <li key={i}>
            <span>
              {s.friendIndex === 0 ? "本人" : s.name}
              {!s.attended && <em>未出席</em>}
            </span>
            <span class="muted">
              场地 ${dollars(s.courtCents)}
              {s.attended && ` + 球 $${dollars(s.shuttleCents)}`}
            </span>
          </li>
        ))}
      </ul>
      {p.status === "paid" && <p class="paid-banner">✓ 已付清，谢谢！</p>}
      {p.refundCents > 0 && <p class="hint">你多付了 ${dollars(p.refundCents)}，群主会退给你。</p>}
      {p.status === "partial" && (
        <p class="hint">
          已收到 ${dollars(p.paidCents)}，还差 <strong>${dollars(owed)}</strong>。补付时备注用同一个编号即可。
        </p>
      )}
      {p.status !== "paid" && (
        <>
          {p.venmoUsername ? (
            <a class="button block venmo" href={venmoLink(p.venmoUsername, owed, p.code)}>
              用 Venmo 付 ${dollars(owed)}
            </a>
          ) : (
            <p class="muted">群主还没设置 Venmo 账号。</p>
          )}
          {inWeChat() && <p class="hint">如果在微信里打不开 Venmo，请点右上角「···」，选择「在浏览器中打开」。</p>}
          <div class="memo">
            <span class="memo-label">备注</span>
            <code>{p.code}</code>
            <CopyButton text={p.code} label="复制" />
          </div>
          <p class="muted small">备注里一定要带上这个编号，系统才能自动确认你的付款。</p>
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
              <dd>${dollars(owed)}</dd>
              <dt>备注</dt>
              <dd>同上</dd>
            </dl>
            {p.zelleAccount && <p class="muted small">也可以用 Zelle 转到 {p.zelleAccount}，但需要群主手动确认。</p>}
          </div>
        </>
      )}
    </div>
  );
}
