// CI helper: push Worker secrets after deploy.
// - ADMIN_PASSWORD comes from the GitHub secret on every deploy; the Worker resets the stored
//   password hash when it changes, which is how a forgotten password is recovered.
// - TELEGRAM_BOT_TOKEN and GOOGLE_MAPS_API_KEY come from the GitHub secrets when they are set.
// - TOKEN_KEY is never replaced: it decrypts member links and peppers the password hash. Its backup
//   lives in the GitHub secret LINK_ENCRYPTION_KEY (LINK_ENCRYPTION_KEY_STAGING for the test site),
//   passed in here as LINK_ENCRYPTION_KEY. Every deploy checks the backup still opens the stored
//   admin link; if the Worker ever loses its key, the backup is put back instead of a new one.
// Usage: node scripts/sync-secrets.mjs [production|staging] — each Worker has its own secrets.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv[2] ?? "production";
if (!["production", "staging"].includes(target)) throw new Error(`unknown environment ${target}`);
const envArgs = target === "staging" ? ["--env", "staging"] : [];
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args, ...envArgs], { encoding: "utf8" });

const backupName = target === "staging" ? "LINK_ENCRYPTION_KEY_STAGING" : "LINK_ENCRYPTION_KEY";
const backup = process.env.LINK_ENCRYPTION_KEY;

/**
 * True when `key` is the one this site's data is encrypted with: it decrypts the stored admin link
 * (AES-GCM fails on any other key) to the token whose hash is stored. Null when there is no admin
 * link yet to check against. Nothing secret is printed.
 */
async function keyMatches(key) {
  const out = JSON.parse(
    execFileSync(
      "npx",
      [
        "wrangler",
        "d1",
        "execute",
        "DB",
        "--remote",
        "--json",
        "--command",
        "SELECT key, value FROM settings WHERE key IN ('admin_token_hash', 'admin_token_enc')",
        ...envArgs,
      ],
      { encoding: "utf8" },
    ),
  );
  const s = Object.fromEntries((out[0]?.results ?? []).map((r) => [r.key, r.value]));
  if (!s.admin_token_hash || !s.admin_token_enc) return null;
  // Same format as src/worker/lib/crypto.ts: base64url(iv || ciphertext), AES key = SHA-256(TOKEN_KEY).
  const bytes = Buffer.from(s.admin_token_enc, "base64url");
  const aes = await webcrypto.subtle.importKey("raw", createHash("sha256").update(key).digest(), "AES-GCM", false, [
    "decrypt",
  ]);
  try {
    const token = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12) },
      aes,
      bytes.subarray(12),
    );
    return createHash("sha256").update(Buffer.from(token).toString("utf8")).digest("hex") === s.admin_token_hash;
  } catch {
    return false;
  }
}

const existing = new Set(JSON.parse(wrangler("secret", "list", "--format", "json")).map((s) => s.name));
const secrets = {};

if (process.env.ADMIN_PASSWORD) secrets.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
else if (!existing.has("ADMIN_PASSWORD")) throw new Error("ADMIN_PASSWORD GitHub secret is not set");

// Optional: notifications stay off until the bot exists.
if (process.env.TELEGRAM_BOT_TOKEN) secrets.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (process.env.GOOGLE_MAPS_API_KEY) secrets.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (process.env.GOOGLE_CLIENT_ID) secrets.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
if (process.env.GOOGLE_CLIENT_SECRET) secrets.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (process.env.RESEND_API_KEY) secrets.RESEND_API_KEY = process.env.RESEND_API_KEY;
if (process.env.EMAIL_FROM) secrets.EMAIL_FROM = process.env.EMAIL_FROM;
// Cloudflare Turnstile on the public forms: off until the secret is set (src/worker/turnstile.ts).
if (process.env.TURNSTILE_SECRET) secrets.TURNSTILE_SECRET = process.env.TURNSTILE_SECRET;

if (!existing.has("TOKEN_KEY")) {
  if (backup) {
    console.log(`Restoring TOKEN_KEY from ${backupName}`);
    secrets.TOKEN_KEY = backup;
  } else {
    console.log("Generating TOKEN_KEY");
    secrets.TOKEN_KEY = randomBytes(32).toString("base64url");
  }
}

// Checked on every deploy, so a mistyped backup is caught now rather than on the day it's needed.
if (backup) {
  const ok = await keyMatches(backup).catch((err) => {
    console.log(`::warning::Could not check ${backupName}: ${err.message.split("\n")[0]}`);
    return null;
  });
  if (ok === null) console.log(`${backupName}: not checked (no admin link yet, or the query failed)`);
  else if (ok) console.log(`✓ ${backupName} matches the key this site's links are encrypted with`);
  else {
    console.log(
      `::error::${backupName} does not match the key this site's links are encrypted with; send the key again from 设置 → 备份网站密钥 and update the GitHub secret`,
    );
    process.exitCode = 1;
  }
} else {
  console.log(`::warning::No ${backupName} GitHub secret: TOKEN_KEY has no backup (设置 → 备份网站密钥)`);
}

if (Object.keys(secrets).length === 0) process.exit();
const dir = mkdtempSync(join(tmpdir(), "secrets-"));
const file = join(dir, "secrets.json");
try {
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  wrangler("secret", "bulk", file);
  console.log(`Updated ${target} secrets: ${Object.keys(secrets).join(", ")}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
