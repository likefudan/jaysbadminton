import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import headersFile from "../src/web/public/_headers?raw";
import { CSP, CSP_HEADER, HSTS, SECURITY_HEADERS } from "../src/shared/security";
import { checkPassword } from "../src/worker/auth";
import { hashPassword, passwordHashIsOld, verifyPassword } from "../src/worker/lib/crypto";
import { ORIGIN, setUpAdmin } from "./helpers";

describe("security headers", () => {
  it("the Worker sends the content policy and HSTS", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/public/site`);
    expect(res.headers.get(CSP_HEADER)).toBe(CSP);
    expect(res.headers.get("Strict-Transport-Security")).toBe(HSTS);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
  });

  it("the static pages' _headers file says the same, header for header", () => {
    // The first block ("/*"); the one after it only says how long /assets/ files are kept.
    const lines = headersFile
      .split("\n/assets/")[0]!
      .split("\n")
      .filter((l) => /^ {2}\S/.test(l));
    expect(lines.sort()).toEqual(
      Object.entries(SECURITY_HEADERS)
        .map(([name, value]) => `  ${name}: ${value}`)
        .sort(),
    );
  });

  it("accepts violation reports without an error", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/csp-report`, {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: JSON.stringify({ "csp-report": { "blocked-uri": "inline" } }),
    });
    expect(res.status).toBe(204);
  });
});

describe("the stored password hash", () => {
  it("is made again with today's iterations at the first right password, and old ones still open", async () => {
    await setUpAdmin();
    const stored = async () =>
      (await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").first<{ value: string }>())!
        .value;
    expect(await stored()).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}:100000$/);
    // As it was stored before 2026-11-19: 5000 iterations, and no count written down.
    const old = (await hashPassword("initial-password", env.TOKEN_KEY, undefined, 5000)).replace(/:5000$/, "");
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password_hash'").bind(old).run();
    expect(passwordHashIsOld(old)).toBe(true);
    expect(await checkPassword(env, "wrong-password")).toBe(false);
    expect(await stored()).toBe(old);
    expect(await checkPassword(env, "initial-password")).toBe(true);
    expect(await stored()).toMatch(/:100000$/);
    expect(await checkPassword(env, "initial-password")).toBe(true);
    // A count nobody would have written is refused, not run.
    expect(await verifyPassword("initial-password", `${old}:99999999`, env.TOKEN_KEY)).toBe(false);
  });
});
