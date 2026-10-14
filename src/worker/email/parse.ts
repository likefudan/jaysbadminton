import PostalMime from "postal-mime";

/** What a Venmo "paid you" receipt says. Amounts are cents; names are Venmo display names. */
export interface VenmoReceipt {
  payer: string;
  amountCents: number;
  note: string;
  /** As printed, e.g. "Sep 28, 2026". */
  date: string;
  txnId: string;
  /** Recipient username without the leading @. */
  sentTo: string;
}

export interface ParsedEmail {
  fromAddress: string;
  subject: string;
  /** Lowercased To addresses; Venmo addresses receipts to the account's registered email. */
  toAddresses: string[];
  messageId: string;
  /** Visible text of the message, one line per block element; kept for parse_failed rows. */
  text: string;
  receipt: VenmoReceipt | null;
  receiptError?: string;
}

const BLOCK = /<\/?(?:br|p|div|h[1-6]|tr|td|th|li|table|section|header|footer)\b[^>]*>/gi;
const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/** HTML to trimmed, non-empty text lines. Hidden elements stay: Venmo splits "$7.00" across spans. */
export function htmlLines(html: string): string[] {
  const text = html
    .replace(/<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(BLOCK, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[name.toLowerCase()] ?? all;
    });
  return text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const toCents = (s: string): number | null => {
  const m = /^\$?\s*(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/.exec(s.trim());
  return m ? Number(m[1]!.replace(/,/g, "")) * 100 + Number(m[2]) : null;
};

const after = (lines: string[], label: string, from: number) => {
  const i = lines.indexOf(label, from);
  return i >= 0 ? lines[i + 1] : undefined;
};

/**
 * Reads the receipt body using the field rules in the requirements: payer before "paid you",
 * the amount after it, the note up to "Money credited to your Venmo account.", then the
 * Date / Transaction ID / Sent to values. Returns null when any field is missing.
 */
export function parseReceipt(
  lines: string[],
  subject: string,
  onFailure?: (reason: string) => void,
): VenmoReceipt | null {
  const fail = (reason: string) => {
    onFailure?.(reason);
    return null;
  };
  const title = lines.findIndex((l) => / paid you$/.test(l));
  if (title < 0) return fail("正文未找到付款人和 paid you 标记");
  const payer = lines[title]!.replace(/ paid you$/, "").trim();

  // The amount follows as one line ("$7.00") or as fragments ("$", "7", ".", "00").
  let i = title + 1;
  let amountText = "";
  while (i < lines.length && /^[$\d.,]+$/.test(lines[i]!)) amountText += lines[i++];
  const amountCents = toCents(amountText);
  if (amountCents === null) return fail("正文付款金额无法解析为美元金额（两位小数）");

  const credited = lines.indexOf("Money credited to your Venmo account.", i);
  if (credited < 0) return fail("正文未找到 Money credited to your Venmo account. 标记");
  const note = lines
    .slice(i, credited)
    .filter((l) => l !== "See transaction")
    .join(" ")
    .trim();

  const date = after(lines, "Date", credited);
  const txnId = after(lines, "Transaction ID", credited);
  const sentTo = after(lines, "Sent to", credited)?.replace(/^@/, "");
  if (!payer || !date || !txnId || !sentTo)
    return fail(
      `正文缺少字段：${[!payer && "付款人", !date && "日期", !txnId && "交易 ID", !sentTo && "收款用户名"].filter(Boolean).join("、")}`,
    );
  if (!/^[A-Za-z0-9]+$/.test(txnId)) return fail("交易 ID 格式不正确（应为字母或数字）");

  // The subject is signed too; disagreeing amounts mean the layout changed under us.
  const subjectAmount = /paid (\$[\d,]+\.\d{2}) to your Venmo account/.exec(subject.replace(/\s+/g, " "));
  if (subjectAmount && toCents(subjectAmount[1]!) !== amountCents) return fail("标题金额与正文金额不一致");

  return { payer, amountCents, note, date, txnId, sentTo };
}

export async function parseEmail(raw: ArrayBuffer | Uint8Array): Promise<ParsedEmail> {
  const mail = await PostalMime.parse(raw);
  const lines = mail.html
    ? htmlLines(mail.html)
    : (mail.text ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
  const subject = mail.subject ?? "";
  let receiptError: string | undefined;
  const receipt = parseReceipt(lines, subject, (reason) => {
    receiptError = reason;
  });
  return {
    fromAddress: (mail.from?.address ?? "").toLowerCase(),
    subject,
    toAddresses: (mail.to ?? []).flatMap((a) =>
      a.address ? [a.address.toLowerCase()] : (a.group ?? []).map((g) => g.address.toLowerCase()),
    ),
    messageId: (mail.messageId ?? "").slice(0, 200),
    text: lines.join("\n"),
    receipt,
    receiptError,
  };
}
