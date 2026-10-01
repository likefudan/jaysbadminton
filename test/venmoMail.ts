import { canonicalBody, signatureInput, signedHeaderBlock, splitMessage } from "../src/worker/email/dkim";

/**
 * Synthetic Venmo receipts shaped like the real ones (HTML only, amount split across spans,
 * hidden preheader, Transaction details block), signed with a key generated for the tests.
 */
export interface ReceiptFields {
  payer?: string;
  amount?: string; // "56.00"
  note?: string;
  txnId?: string;
  sentTo?: string;
  from?: string;
  to?: string;
}

const CRLF = "\r\n";
let keys: CryptoKeyPair | undefined;
let publicRecord = "";

export async function testKey() {
  if (!keys) {
    keys = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const spki = (await crypto.subtle.exportKey("spki", keys.publicKey)) as ArrayBuffer;
    publicRecord = `v=DKIM1; k=rsa; p=${b64(spki)}`;
  }
  return { keys, resolveKey: async (s: string, d: string) => (s === "test" && (d === "venmo.com" || d === "google.com") ? publicRecord : null) };
}

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

export function receiptHtml(f: Required<ReceiptFields>): string {
  const [dollars, cents] = f.amount.split(".");
  return `<!DOCTYPE html><html><head><style>.x{color:red}</style></head><body>
<span style="display:none">${f.payer} paid you $${f.amount}</span>
<table><tr><td>
<p class="text-center secondary-text title">${f.payer} paid you</p>
<div class="amount-container__centered"><div>$</div><div>${dollars}</div><span style="display:none">.</span><div>${cents}</div></div>
<p class="transaction-note">${f.note}</p>
<a href="https://venmo.com/">See transaction</a>
<h2>Money credited to your Venmo account.</h2>
<h2>Transaction details</h2>
<h3>Date</h3><p class="transaction-value">Sep 28, 2026</p>
<h3>Transaction ID</h3><p class="transaction-value">${f.txnId}</p>
<h3>Sent to</h3><p class="transaction-value"> @${f.sentTo} </p>
<p>For any issues, please contact us.</p>
</td></tr></table></body></html>`;
}

/** A complete raw message, DKIM-signed for venmo.com unless `sign` is false. */
export async function venmoEmail(fields: ReceiptFields = {}, opts: { sign?: boolean; tamper?: (raw: string) => string; html?: (html: string) => string; domain?: string; subject?: string; body?: string } = {}) {
  const f: Required<ReceiptFields> = {
    payer: "Alice W",
    amount: "56.00",
    note: "Badminton",
    txnId: "TXN" + Math.random().toString(36).slice(2, 12).toUpperCase(),
    sentTo: "KeLi8916",
    from: "Venmo <venmo@venmo.com>",
    to: "owner@example.com",
    ...fields,
  };
  const body =
    `------=_Part_1${CRLF}Content-Type: text/plain; charset=UTF-8${CRLF}${CRLF}${CRLF}` +
    `------=_Part_1${CRLF}Content-Type: text/html; charset=UTF-8${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}` +
    (opts.body ?? (opts.html ?? ((h: string) => h))(receiptHtml(f))).replace(/\n/g, CRLF) +
    `${CRLF}------=_Part_1--${CRLF}`;
  const signedHeaders = [
    `From: ${f.from}`,
    `To: ${f.to}`,
    `Subject: ${opts.subject ?? `${f.payer} paid $${f.amount} to your Venmo account. Leave it in Venmo or${CRLF} transfer it to your bank account.`}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative;${CRLF}\tboundary="----=_Part_1"`,
    `Message-ID: <${f.txnId}@email.example.com>`,
    `Date: Mon, 28 Sep 2026 07:06:35 +0000`,
  ];
  let head = signedHeaders.join(CRLF);
  if (opts.sign !== false) {
    const { keys } = await testKey();
    const bodyBytes = new TextEncoder().encode(body);
    const bh = b64(await crypto.subtle.digest("SHA-256", canonicalBody(bodyBytes, "simple")));
    const unsigned = `DKIM-Signature: v=1; a=rsa-sha256; q=dns/txt; c=relaxed/simple;${CRLF}\ts=test; d=${opts.domain ?? "venmo.com"}; t=1790579195;${CRLF}\th=From:To:Subject:MIME-Version:Content-Type:Message-ID:Date;${CRLF}\tbh=${bh};${CRLF}\tb=`;
    const { headers } = splitMessage(new TextEncoder().encode(`${head}${CRLF}${CRLF}`));
    const data =
      signedHeaderBlock(headers, ["from", "to", "subject", "mime-version", "content-type", "message-id", "date"], "relaxed") +
      signatureInput(unsigned, "relaxed");
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(data));
    head = `${unsigned}${b64(sig).replace(/(.{64})/g, `$1${CRLF}\t`)}${CRLF}${head}`;
  }
  // What Gmail and Email Routing add on top when forwarding.
  head = `Received: by mx.example.net; Mon, 28 Sep 2026 00:06:36 -0700${CRLF}X-Forwarded-For: owner@example.com${CRLF}${head}`;
  let raw = `${head}${CRLF}${CRLF}${body}`;
  if (opts.tamper) raw = opts.tamper(raw);
  return { raw: new TextEncoder().encode(raw), fields: f };
}
