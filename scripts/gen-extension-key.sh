#!/usr/bin/env bash
# Generates the extension's signing key and prints the manifest `key` and the extension ID.
#
# Only the public key is committed (manifest `key` and crates/bridge/extension-ids.txt); it fixes
# the development extension ID for everyone. The private key stays in extension/key.pem, which
# is git-ignored and must never be committed.
#
# Usage: scripts/gen-extension-key.sh          create extension/key.pem (refuses to overwrite)
#        scripts/gen-extension-key.sh --print  print the key and ID of the existing key.pem
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
pem="$root/extension/key.pem"

if [[ "${1:-}" != "--print" ]]; then
  if [[ -e "$pem" ]]; then
    echo "error: $pem already exists; use --print, or move it away first" >&2
    exit 1
  fi
  (umask 077 && openssl genrsa 2048 2>/dev/null | openssl pkcs8 -topk8 -nocrypt -out "$pem")
fi

der() { openssl pkey -in "$pem" -pubout -outform DER 2>/dev/null; }

# Chrome's ID: the first 32 hex digits of SHA-256(public key DER), with 0-9a-f mapped to a-p.
key="$(der | base64 | tr -d '\n')"
id="$(der | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p')"

echo "key: $key"
echo "id:  $id"
