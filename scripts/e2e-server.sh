#!/bin/sh
# Starts a throwaway local site for the browser tests: its own database under .wrangler/e2e,
# migrated from scratch, on port 8788. Needs `npm run build` first (the tests' npm script does it).
set -e
cd "$(dirname "$0")/.."
if [ ! -f .dev.vars ]; then
  # CI has no .dev.vars; these values exist only inside this local test server.
  printf 'TOKEN_KEY=e2e-token-key-not-secret\nADMIN_PASSWORD=local-password\n' > .dev.vars
fi
rm -rf .wrangler/e2e
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e > /dev/null
exec npx wrangler dev --port 8788 --persist-to .wrangler/e2e --show-interactive-dev-session=false
