#!/usr/bin/env bash
# Development only: builds islet-native-host and registers it with Google Chrome for the
# current user, pointing at target/debug. The app does the same for its bundled host on every
# start. Re-run it after moving the checkout.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

cargo build -q -p islet-native-host
cargo run -q -p islet-bridge --example install-native-host -- "$root/target/debug/islet-native-host"
