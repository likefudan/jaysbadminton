// CI helper: push Worker secrets after deploy.
// - ADMIN_PASSWORD comes from the GitHub secret on every deploy; the Worker resets the stored
//   password hash when it changes, which is how a forgotten password is recovered.
// - TELEGRAM_BOT_TOKEN comes from the GitHub secret when it is set.
// - TOKEN_KEY is generated once and never replaced: it decrypts member links and peppers the password hash.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });

const existing = new Set(JSON.parse(wrangler("secret", "list", "--format", "json")).map((s) => s.name));
const secrets = {};

if (process.env.ADMIN_PASSWORD) secrets.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
else if (!existing.has("ADMIN_PASSWORD")) throw new Error("ADMIN_PASSWORD GitHub secret is not set");

// Optional: notifications stay off until the bot exists.
if (process.env.TELEGRAM_BOT_TOKEN) secrets.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!existing.has("TOKEN_KEY")) {
  console.log("Generating TOKEN_KEY");
  secrets.TOKEN_KEY = randomBytes(32).toString("base64url");
}

if (Object.keys(secrets).length === 0) process.exit(0);
const dir = mkdtempSync(join(tmpdir(), "secrets-"));
const file = join(dir, "secrets.json");
try {
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  wrangler("secret", "bulk", file);
  console.log(`Updated secrets: ${Object.keys(secrets).join(", ")}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
