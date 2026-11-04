#!/usr/bin/env bash
# Packages the release extension for the Chrome Web Store, which refuses a manifest "key": the
# store signs the package itself and gives it its own ID. Writes
# islet-extension-<version>-chrome-web-store.zip to the given folder (default: the current one).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$(cd "${1:-.}" && pwd)"
cd "$root"

pnpm --filter @islet/extension build

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -R extension/dist/. "$tmp"
node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  delete manifest.key;
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
' "$tmp/manifest.json"

version="$(node -p 'require(process.argv[1]).version' "$tmp/manifest.json")"
out="$dest/islet-extension-$version-chrome-web-store.zip"
rm -f "$out"
(cd "$tmp" && zip -qr "$out" .)
echo "$out"
