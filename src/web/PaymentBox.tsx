import { dollars, venmoLink } from "../shared/settle";
import type { MyPayment } from "../shared/types";
import { CopyButton } from "./components";
import { t, tx } from "./i18n";

const inWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

export function PaymentBox(props: { p: MyPayment }) {
  const p = props.p;
  const owed = p.amountCents - p.paidCents; // what the Venmo button asks for after a partial payment
  return (
    <div class="paybox">
      <p class="pay-label">{t("本次应付 · 付给{name}", { name: p.payeeName })}</p>
      <p class="amount">${dollars(p.amountCents)}</p>
      <ul class="breakdown">
        {p.shares.map((s, i) => (
          <li key={i}>
            <span>
              {s.friendIndex === 0 && !s.guest ? t("本人") : s.name}
              {!s.attended && <em>{t("未出席")}</em>}
            </span>
            <span class="muted">
              {t("场地 {amount}", { amount: `$${dollars(s.courtCents)}` })}
              {s.attended && ` + ${t("球 {amount}", { amount: `$${dollars(s.shuttleCents)}` })}`}
            </span>
          </li>
        ))}
      </ul>
      {p.status === "paid" && <p class="paid-banner">✓ {t("已付清，谢谢！")}</p>}
      {p.refundCents > 0 && (
        <p class="hint">
          {t("你多付了 {amount}，{name}会退给你。", { amount: `$${dollars(p.refundCents)}`, name: p.payeeName })}
        </p>
      )}
      {p.status === "partial" && (
        <p class="hint">
          {tx("已收到 {paid}，还差 {owed}", {
            paid: `$${dollars(p.paidCents)}`,
            owed: <strong>${dollars(owed)}</strong>,
          })}
        </p>
      )}
      {p.status !== "paid" && (
        <>
          {p.venmoUsername ? (
            <a class="button block venmo" href={venmoLink(p.venmoUsername, owed, p.code)}>
              {t("用 Venmo 付 {amount}", { amount: `$${dollars(owed)}` })}
            </a>
          ) : (
            <p class="muted">{t("{name}还没设置 Venmo 账号。", { name: p.payeeName })}</p>
          )}
          {inWeChat() && (
            <p class="hint">{t("如果在微信里打不开 Venmo，请点右上角「···」，选择「在浏览器中打开」。")}</p>
          )}
          <div class="memo">
            <span class="memo-label">{t("备注")}</span>
            <code>{p.code}</code>
            <CopyButton text={p.code} label={t("复制")} />
          </div>
          <details class="manual">
            <summary>
              {p.zelleAccount ? t("其他付款方式（Venmo 手动 / Zelle）") : t("其他付款方式（Venmo 手动）")}
            </summary>
            <dl>
              {p.venmoUsername && (
                <>
                  <dt>Venmo</dt>
                  <dd>@{p.venmoUsername}</dd>
                </>
              )}
              <dt>{t("金额")}</dt>
              <dd>${dollars(owed)}</dd>
              <dt>{t("备注")}</dt>
              <dd>{t("同上")}</dd>
            </dl>
            {p.zelleAccount && (
              <p class="muted small">
                {t("也可以用 Zelle 转到 {account}，但需要{name}手动确认。", {
                  account: p.zelleAccount,
                  name: p.payeeName,
                })}
              </p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
