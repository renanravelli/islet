// Writes a release version into every file that holds the app's version (CLAUDE.md, "Releasing").
// A beta such as 0.1.1-beta.2 goes as is everywhere except the extension manifest, where Chrome
// allows only numbers: there `version` is 0.1.1 and `version_name` shows 0.1.1-beta.2. Cargo.lock
// follows with `cargo update --workspace`. Used by .github/workflows/release.yml.
//
// Usage: node scripts/set-version.mjs <major.minor.patch>[-beta.<n>]

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2] ?? "";
const match = /^(\d+\.\d+\.\d+)(-beta\.[1-9]\d*)?$/.exec(version);
if (!match) {
  console.error("usage: node scripts/set-version.mjs <major.minor.patch>[-beta.<n>]");
  process.exit(1);
}
const [, base, beta] = match;

const root = new URL("..", import.meta.url);
function edit(path, change) {
  const url = new URL(path, root);
  const text = readFileSync(url, "utf8");
  const next = change(text);
  if (next === undefined) throw new Error(`no version found in ${path}`);
  writeFileSync(url, next);
}
function replace(pattern, value) {
  return (text) => (pattern.test(text) ? text.replace(pattern, `$1${value}$2`) : undefined);
}

edit("Cargo.toml", replace(/(\[workspace\.package\][^[]*?\nversion = ")[^"]+(")/, version));
for (const path of [
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/package.json",
  "extension/package.json",
  "packages/protocol-ts/package.json",
  "packages/ui-types/package.json",
]) {
  edit(path, replace(/("version": ")[^"]+(")/, version));
}
edit("extension/manifest.json", (text) => {
  const withVersion = replace(/("version": ")[^"]+(")/, base)(text);
  if (withVersion === undefined) return undefined;
  const plain = withVersion.replace(/\n {2}"version_name": "[^"]*",/, "");
  return beta
    ? plain.replace(/(\n {2}"version": "[^"]+",)/, `$1\n  "version_name": "${version}",`)
    : plain;
});
console.log(`version ${version}`);
