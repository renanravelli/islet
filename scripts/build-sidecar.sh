#!/usr/bin/env bash
# Builds islet-native-host as the app's sidecar: apps/desktop/src-tauri/binaries/
# islet-native-host-<target triple>, the name Tauri's bundle.externalBin expects. With
# --universal, builds both Apple targets and merges them with lipo into
# islet-native-host-universal-apple-darwin (docs/adr/0001).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/apps/desktop/src-tauri/binaries"
mkdir -p "$out"
cd "$root"

if [[ "${1:-}" == "--universal" ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
  for target in aarch64-apple-darwin x86_64-apple-darwin; do
    cargo build --release -p islet-native-host --target "$target"
  done
  lipo -create \
    target/aarch64-apple-darwin/release/islet-native-host \
    target/x86_64-apple-darwin/release/islet-native-host \
    -output "$out/islet-native-host-universal-apple-darwin"
  echo "$out/islet-native-host-universal-apple-darwin"
else
  triple="$(rustc -vV | sed -n 's/^host: //p')"
  cargo build --release -p islet-native-host
  cp target/release/islet-native-host "$out/islet-native-host-$triple"
  echo "$out/islet-native-host-$triple"
fi
