const enc = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A 32-byte random token, base64url (43 characters). */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function keyMaterial(secret: string): Promise<Uint8Array> {
  // TOKEN_KEY may be any string; derive a fixed 32-byte key from it.
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(secret)));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await keyMaterial(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypts a token so the Owner can view a member's link again. Output: base64url(iv || ciphertext). */
export async function encryptToken(token: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(token)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toBase64Url(out);
}

export async function decryptToken(blob: string, secret: string): Promise<string> {
  const bytes = fromBase64Url(blob);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    await aesKey(secret),
    bytes.slice(12),
  );
  return new TextDecoder().decode(pt);
}

export async function hmac(text: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    await keyMaterial(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

// 100,000 is the most the Workers runtime allows for PBKDF2. The secret pepper (TOKEN_KEY) keeps a
// leaked database alone from being brute-forced offline on top of that.
const PBKDF2_ITERATIONS = 100_000;
// Hashes made before 2026-11-19 are "salt:hash" and used this many (the free plan's 10 ms of CPU).
const PBKDF2_ITERATIONS_OLD = 5000;

/** "salt:hash:iterations". */
export async function hashPassword(
  password: string,
  pepper: string,
  saltHex?: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = saltHex ?? toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const base = await crypto.subtle.importKey("raw", enc.encode(await hmac(password, pepper)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations },
    base,
    256,
  );
  return `${salt}:${toHex(bits)}:${iterations}`;
}

const iterationsOf = (stored: string) => Number(stored.split(":")[2] ?? PBKDF2_ITERATIONS_OLD);

export async function verifyPassword(password: string, stored: string, pepper: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  const iterations = iterationsOf(stored);
  if (!salt || !hash || !Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  const again = await hashPassword(password, pepper, salt, iterations);
  return timingSafeEqual(again.split(":")[1]!, hash);
}

/** A hash made with fewer iterations than today's: make it again at the next right password. */
export const passwordHashIsOld = (stored: string) => iterationsOf(stored) !== PBKDF2_ITERATIONS;

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
