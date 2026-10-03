// CI helper: after a deploy, check the live site from the outside. Read-only; changes nothing.
// Retries for a minute while the new version reaches every Cloudflare location.
const site = process.env.SITE_ORIGIN ?? "https://jaysbadminton.llmat.dev";

const checks = [
  [
    "home page",
    "/",
    (r, body) => r.status === 200 && body.includes('<div id="app">') && r.headers.get("x-frame-options") === "DENY",
  ],
  ["home page has its link preview", "/", (r, body) => body.includes('property="og:url"')],
  ["icon manifest", "/manifest.webmanifest", (r, body) => r.status === 200 && body.includes("icon-512.png")],
  ["health", "/api/health", (r, body) => r.status === 200 && JSON.parse(body).ok === true],
  ["public home", "/api/public/home", (r, body) => r.status === 200 && Array.isArray(JSON.parse(body).currentEvents)],
  ["admin needs a valid link", "/api/admin/not-a-real-link/members", (r) => r.status === 404],
  ["export needs a valid key", "/export/not-a-real-key/all.json", (r) => r.status === 403],
  [
    "Telegram webhook needs the secret",
    "/api/telegram/webhook",
    (r) => r.status === 403,
    { method: "POST", body: "{}" },
  ],
];

let failed = 0;
for (const [name, path, ok, init] of checks) {
  let passed = false;
  let detail = "";
  for (let attempt = 0; attempt < 6 && !passed; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 10_000));
    try {
      const res = await fetch(site + path, init);
      const body = await res.text();
      passed = ok(res, body);
      detail = `HTTP ${res.status}`;
    } catch (err) {
      detail = err.message;
    }
  }
  console.log(`${passed ? "✓" : "✗"} ${name} (${detail})`);
  if (!passed) failed++;
}
if (failed) {
  console.error(`${failed} smoke check(s) failed against ${site}`);
  process.exit(1);
}
