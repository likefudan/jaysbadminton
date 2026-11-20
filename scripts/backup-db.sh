#!/usr/bin/env bash
# Backs up a D1 database, ENCRYPTED, into the private R2 bucket $BACKUP_BUCKET (default
# jaysbadminton-backups) as <stem>.sql.gz.enc. Nothing is kept on GitHub: anyone who can read the
# repository's Actions can download its artifacts, so backups are never uploaded as one. The plain
# SQL never leaves this runner. The bucket is made on first use and deletes backups after 90 days.
#
# Usage: scripts/backup-db.sh <stem> [extra wrangler args, e.g. --config wrangler.sbbc.json]
# Needs BACKUP_KEY (GitHub secret; keep a copy in a password manager, GitHub can't show it again) and
# a CLOUDFLARE_API_TOKEN that may edit R2 (permission "Workers R2 Storage: Edit").
#
# Restore (on your own computer):
#   npx wrangler r2 object get jaysbadminton-backups/<stem>.sql.gz.enc --remote --file <stem>.sql.gz.enc
#   BACKUP_KEY='…' openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY \
#     -in <stem>.sql.gz.enc | gunzip > <stem>.sql
# then, into a new empty database (rows with photos are too long for D1 as exported):
#   node scripts/split-sql.mjs <stem>.sql <stem>.import.sql
#   npx wrangler d1 execute <database> --remote --file <stem>.import.sql
set -euo pipefail

if [ -z "${BACKUP_KEY:-}" ]; then
  echo "::error::No BACKUP_KEY GitHub secret: backups are encrypted with it (openssl rand -base64 32; keep a copy)"
  exit 1
fi
stem=$1
shift

plain=$(mktemp -d)
trap 'rm -rf "$plain"' EXIT
npx wrangler d1 export DB --remote "$@" --output "$plain/$stem.sql"
gzip -9 "$plain/$stem.sql"

out="$plain/$stem.sql.gz.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_KEY -in "$plain/$stem.sql.gz" -out "$out"

# Proves the file opens with the key before the plain copy is gone.
want=$(sha256sum < "$plain/$stem.sql.gz" | cut -d' ' -f1)
got=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY -in "$out" | sha256sum | cut -d' ' -f1)
if [ "$want" != "$got" ]; then
  echo "::error::Encrypted backup does not decrypt to the export"
  exit 1
fi

bucket=${BACKUP_BUCKET:-jaysbadminton-backups}
key="$stem.sql.gz.enc"
# The Cloudflare API sometimes fails a request for a moment (v2026.11.19.2: `bucket info` failed, then
# `bucket create` said the bucket exists), so the check is tried three times, and "already exists"
# from create counts as success.
bucket_exists() {
  for wait in 0 5 15; do
    sleep "$wait"
    if npx wrangler r2 bucket info "$bucket" > /dev/null 2>&1; then return 0; fi
  done
  return 1
}
if ! bucket_exists; then
  echo "Making the private bucket $bucket (backups are deleted after 90 days)"
  if created=$(npx wrangler r2 bucket create "$bucket" 2>&1); then
    echo "$created"
    npx wrangler r2 bucket lifecycle add "$bucket" expire-after-90-days --expire-days 90 --force
  elif grep -q "already exists, and you own it" <<< "$created"; then
    echo "The bucket $bucket already exists (the first check failed for a moment)"
  else
    echo "$created"
    echo "::error::Cannot use the R2 bucket $bucket: turn on R2 in the Cloudflare dashboard and give the CLOUDFLARE_API_TOKEN the permission Workers R2 Storage: Edit"
    exit 1
  fi
fi
npx wrangler r2 object put "$bucket/$key" --file "$out" --remote

# Proves what the bucket holds is the file made here.
npx wrangler r2 object get "$bucket/$key" --remote --file "$plain/stored.enc"
if ! cmp -s "$out" "$plain/stored.enc"; then
  echo "::error::The backup in R2 is not the file that was uploaded"
  exit 1
fi
echo "Encrypted backup: R2 $bucket/$key ($(stat -c %s "$out") bytes)"
