// CI helper: after the release site (ops/, badminton.llmat.dev) deploys, push its secrets from the GitHub
// secrets that are set. OPS_SESSION_KEY signs its login cookies; it is made here once and never
// replaced (a new one only signs Ke Li out, so it needs no backup).
// Usage: node scripts/sync-ops-secrets.mjs
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wrangler = (...args) =>
  execFileSync("npx", ["wrangler", ...args, "--config", "ops/wrangler.jsonc"], { encoding: "utf8" });

const existing = new Set(JSON.parse(wrangler("secret", "list", "--format", "json")).map((s) => s.name));
const secrets = {};
const optional = ["TELEGRAM_DEV_BOT_TOKEN", "TELEGRAM_DEV_CHAT_ID"];
for (const name of ["OPS_GITHUB_TOKEN", "OPS_EMAIL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", ...optional]) {
  if (process.env[name]) secrets[name] = process.env[name].trim();
  else if (!existing.has(name))
    console.log(`::warning::GitHub secret ${name} is not set: the release site waits for it`);
}
if (!existing.has("OPS_SESSION_KEY")) secrets.OPS_SESSION_KEY = randomBytes(32).toString("base64url");

const dir = mkdtempSync(join(tmpdir(), "ops-secrets-"));
try {
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  if (Object.keys(secrets).length) wrangler("secret", "bulk", file);
  console.log(`Release site secrets: ${Object.keys(secrets).join(", ") || "none to change"}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
