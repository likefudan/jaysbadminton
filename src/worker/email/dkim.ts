/**
 * Minimal DKIM verifier (RFC 6376), enough to prove a receipt really came from Venmo:
 * rsa-sha256 only, relaxed or simple canonicalization, no l= body length. Forwarding through
 * Gmail and Email Routing only adds headers on top, so Venmo's signature still verifies.
 */

export type KeyResolver = (selector: string, domain: string) => Promise<string | null>;

export interface DkimResult {
  ok: boolean;
  /** Why verification failed, for logs and the parse_failed row. */
  reason?: string;
  /** The key could not be fetched; the signature was never checked. */
  retryable?: boolean;
}

interface Header {
  name: string; // lowercased
  raw: string; // "Name: value" with folding CRLFs, no trailing CRLF
}

const enc = new TextEncoder();
const CRLF = "\r\n";

/** Splits the raw message into header fields and body bytes, normalizing bare LF to CRLF. */
export function splitMessage(raw: Uint8Array): { headers: Header[]; body: Uint8Array } {
  let bytes = raw;
  if (!includesCrlf(bytes)) bytes = enc.encode(new TextDecoder().decode(bytes).replace(/\n/g, CRLF));
  let end = -1;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      end = i;
      break;
    }
  }
  const headerText = new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
  const body = end < 0 ? new Uint8Array() : bytes.subarray(end + 4);
  const headers: Header[] = [];
  for (const line of headerText.split(CRLF)) {
    if (/^[ \t]/.test(line) && headers.length) headers[headers.length - 1]!.raw += CRLF + line;
    else if (line.includes(":")) headers.push({ name: line.slice(0, line.indexOf(":")).trim().toLowerCase(), raw: line });
  }
  return { headers, body };
}

function includesCrlf(b: Uint8Array): boolean {
  for (let i = 0; i + 1 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10) return true;
  return false;
}

export function relaxedHeader(raw: string): string {
  const colon = raw.indexOf(":");
  const name = raw.slice(0, colon).trim().toLowerCase();
  const value = raw
    .slice(colon + 1)
    .replace(/\r\n/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  return `${name}:${value}`;
}

const simpleHeader = (raw: string) => raw;

export function canonicalBody(body: Uint8Array, mode: "simple" | "relaxed"): Uint8Array {
  if (mode === "simple") {
    let end = body.length;
    while (end >= 2 && body[end - 2] === 13 && body[end - 1] === 10) end -= 2;
    const out = new Uint8Array(end + 2);
    out.set(body.subarray(0, end));
    out.set([13, 10], end);
    return out;
  }
  // Byte-per-char string so non-ASCII bytes survive the round trip untouched.
  let text = "";
  for (let i = 0; i < body.length; i += 8192) text += String.fromCharCode(...body.subarray(i, i + 8192));
  text = text
    .split(CRLF)
    .map((l) => l.replace(/[ \t]+/g, " ").replace(/ $/, ""))
    .join(CRLF)
    .replace(/(\r\n)+$/, "");
  return text ? latin1Bytes(text + CRLF) : new Uint8Array();
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function parseTags(value: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    tags.set(part.slice(0, eq).trim(), part.slice(eq + 1).replace(/\s+/g, ""));
  }
  return tags;
}

/** The DKIM-Signature field as it is hashed: canonicalized, b= emptied, no trailing CRLF. */
export function signatureInput(raw: string, headerMode: "simple" | "relaxed"): string {
  const colon = raw.indexOf(":");
  const stripped = raw.slice(0, colon + 1) + raw.slice(colon + 1).replace(/((?:^|;)\s*b\s*=)[^;]*/, "$1");
  return headerMode === "relaxed" ? relaxedHeader(stripped) : simpleHeader(stripped);
}

/** Signed headers, each picked bottom-up as RFC 6376 §5.4.2 requires. */
export function signedHeaderBlock(headers: Header[], names: string[], headerMode: "simple" | "relaxed"): string {
  const used = new Set<number>();
  let out = "";
  for (const n of names) {
    const name = n.trim().toLowerCase();
    for (let i = headers.length - 1; i >= 0; i--) {
      if (headers[i]!.name === name && !used.has(i)) {
        used.add(i);
        out += (headerMode === "relaxed" ? relaxedHeader(headers[i]!.raw) : headers[i]!.raw) + CRLF;
        break;
      }
    }
  }
  return out;
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64of = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

/**
 * Verifies a DKIM signature by `domain` that covers From, To and Subject. Any other signatures
 * (amazonses.com, forwarding hops) are ignored.
 */
export async function verifyDkim(raw: Uint8Array, domain: string, resolveKey: KeyResolver = dohKey): Promise<DkimResult> {
  const { headers, body } = splitMessage(raw);
  const sigs = headers.filter((h) => h.name === "dkim-signature");
  let reason = "no DKIM-Signature for " + domain;
  for (const sig of sigs) {
    const tags = parseTags(sig.raw.slice(sig.raw.indexOf(":") + 1));
    if (tags.get("d")?.toLowerCase() !== domain) continue;
    try {
      const r = await verifyOne(headers, body, sig.raw, tags, resolveKey);
      if (r.ok) return r;
      reason = r.reason ?? "invalid";
    } catch (err) {
      if (err instanceof KeyLookupError) return { ok: false, reason: err.message, retryable: true };
      reason = `error: ${(err as Error).message}`;
    }
  }
  return { ok: false, reason };
}

async function verifyOne(
  headers: Header[],
  body: Uint8Array,
  sigRaw: string,
  tags: Map<string, string>,
  resolveKey: KeyResolver,
): Promise<DkimResult> {
  if (tags.get("v") !== "1") return { ok: false, reason: "bad v=" };
  if (tags.get("a") !== "rsa-sha256") return { ok: false, reason: "unsupported a=" };
  if (tags.has("l")) return { ok: false, reason: "l= not accepted" };
  const [hMode = "simple", bMode = "simple"] = (tags.get("c") ?? "simple/simple").split("/");
  if (!isMode(hMode) || !isMode(bMode)) return { ok: false, reason: "bad c=" };
  const signed = (tags.get("h") ?? "").split(":").map((s) => s.trim().toLowerCase());
  for (const name of SIGNED) if (!signed.includes(name)) return { ok: false, reason: `${name} not signed` };
  // A second From, To or Subject added above the signed one could fool the parser; refuse that.
  for (const name of SIGNED) {
    if (headers.filter((h) => h.name === name).length !== 1) return { ok: false, reason: `multiple ${name} headers` };
  }
  const x = tags.get("x");
  if (x && Number(x) * 1000 < Date.now()) return { ok: false, reason: "signature expired" };

  const bodyHash = b64of(await crypto.subtle.digest("SHA-256", canonicalBody(body, bMode)));
  if (bodyHash !== tags.get("bh")) return { ok: false, reason: "body hash mismatch" };

  const selector = tags.get("s");
  const domain = tags.get("d")!.toLowerCase();
  if (!selector) return { ok: false, reason: "no s=" };
  const record = await resolveKey(selector, domain);
  if (!record) return { ok: false, reason: "key not found" };
  const keyTags = parseTags(record);
  const p = keyTags.get("p");
  if (!p) return { ok: false, reason: "key revoked" };
  const key = await crypto.subtle.importKey("spki", b64(p), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);

  const data = signedHeaderBlock(headers, signed, hMode) + signatureInput(sigRaw, hMode);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(tags.get("b") ?? ""), enc.encode(data));
  return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/** Headers the receipt checks rely on; each must be signed and appear exactly once. */
const SIGNED = ["from", "to", "subject"];

const isMode = (m: string): m is "simple" | "relaxed" => m === "simple" || m === "relaxed";

const keyCache = new Map<string, string>();
const DOH = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"];

/** Thrown when no DNS answer came back at all, as opposed to a key that does not exist. */
export class KeyLookupError extends Error {}

/** Looks the key up over DNS-over-HTTPS (Workers have no raw DNS), with a second provider as fallback. */
export async function dohKey(selector: string, domain: string): Promise<string | null> {
  const name = `${selector}._domainkey.${domain}`;
  const cached = keyCache.get(name);
  if (cached) return cached;
  for (const url of DOH) {
    try {
      const res = await fetch(`${url}?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: "application/dns-json" } });
      if (!res.ok) continue;
      const json = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
      const record = json.Answer?.filter((a) => a.type === 16)
        .map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s*"/g, ""))
        .find((t) => t.includes("p="));
      if (record) keyCache.set(name, record);
      return record ?? null;
    } catch {
      // try the next provider
    }
  }
  throw new KeyLookupError(`DNS lookup failed for ${name}`);
}
