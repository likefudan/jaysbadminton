import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import headersFile from "../src/web/public/_headers?raw";
import { CSP, CSP_HEADER, HSTS } from "../src/shared/security";
import { ORIGIN } from "./helpers";

describe("security headers", () => {
  it("the Worker sends the content policy and HSTS", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/api/public/site`);
    expect(res.headers.get(CSP_HEADER)).toBe(CSP);
    expect(res.headers.get("Strict-Transport-Security")).toBe(HSTS);
  });

  it("the static pages' _headers file says the same", () => {
    expect(headersFile).toContain(`  ${CSP_HEADER}: ${CSP}\n`);
    expect(headersFile).toContain(`  Strict-Transport-Security: ${HSTS}\n`);
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
