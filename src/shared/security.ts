/**
 * Security headers for every page. The Worker sets them on what it serves (API, home, event
 * pages); src/web/public/_headers repeats them for the static pages Cloudflare serves directly,
 * and a test keeps the two the same.
 *
 * The content policy is enforced (Ke Li 2026-11-10; report-only from 2026-10-03 until then):
 * anything it blocks is still reported to /api/csp-report and shows up in the Worker logs.
 */
export const CSP_HEADER = "Content-Security-Policy";

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Inline style attributes (theme swatches, chart bars).
  "style-src 'self' 'unsafe-inline'",
  // QR codes are data: URLs; Google profile pictures come from googleusercontent.com.
  "img-src 'self' data: https://googleusercontent.com https://*.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "report-uri /api/csp-report",
].join("; ");

/** One year of HTTPS-only; no includeSubDomains or preload, so nothing outside this site is bound. */
export const HSTS = "max-age=31536000";

/** Every security header, set by the Worker and repeated in _headers (the test checks each one). */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // Member and admin links carry secret tokens in the path; keep them out of referrers.
  "Referrer-Policy": "no-referrer",
  // camera=(self): 拍照登记 opens the phone camera from a file input (capture); nothing else uses it.
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": HSTS,
  [CSP_HEADER]: CSP,
};
