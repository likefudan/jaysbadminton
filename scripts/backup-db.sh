#!/usr/bin/env bash
# Backs up a D1 database for an Actions artifact, ENCRYPTED: the repository is public and so are
# its artifacts, so the plain SQL never leaves this runner. Writes backup/<stem>.sql.gz.enc.
#
# Usage: scripts/backup-db.sh <stem> [extra wrangler args, e.g. --config wrangler.sbbc.json]
# Needs BACKUP_KEY (GitHub secret; keep a copy in a password manager, GitHub can't show it again).
#
# Restore (on your own computer):
#   BACKUP_KEY='…' openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY \
#     -in <stem>.sql.gz.enc | gunzip > <stem>.sql
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

mkdir -p backup
out="backup/$stem.sql.gz.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_KEY -in "$plain/$stem.sql.gz" -out "$out"

# Proves the file opens with the key before the plain copy is gone.
want=$(sha256sum < "$plain/$stem.sql.gz" | cut -d' ' -f1)
got=$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_KEY -in "$out" | sha256sum | cut -d' ' -f1)
if [ "$want" != "$got" ]; then
  echo "::error::Encrypted backup does not decrypt to the export"
  exit 1
fi
echo "Encrypted backup: $out ($(stat -c %s "$out") bytes)"
