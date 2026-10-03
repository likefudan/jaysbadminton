/**
 * Security headers for every page. The Worker sets them on what it serves (API, home, event
 * pages); src/web/public/_headers repeats them for the static pages Cloudflare serves directly,
 * and a test keeps the two the same.
 *
 * The content policy is report-only for now: violations are reported to /api/csp-report (and
 * show up in the Worker logs) but nothing is blocked. Switch the header name to
 * Content-Security-Policy once the logs stay quiet.
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

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
