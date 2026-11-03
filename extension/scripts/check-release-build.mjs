// Runs after `vite build` (release). Fails if dist/ contains development-only code, network
// APIs or permissions beyond what PRIVACY.md justifies.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const problems = [];

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const FORBIDDEN = [
  ["isletDebug", /isletDebug/],
  ["__ISLET_DEBUG__", /__ISLET_DEBUG__/],
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["WebSocket", /WebSocket/],
  ["sendBeacon", /sendBeacon/],
  ["EventSource", /EventSource/],
];

for (const file of files(dist).filter((f) => f.endsWith(".js"))) {
  const code = readFileSync(file, "utf8");
  for (const [name, pattern] of FORBIDDEN) {
    if (pattern.test(code)) problems.push(`${file.slice(dist.length)} contains ${name}`);
  }
}

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (!same(manifest.permissions, ["nativeMessaging"])) problems.push("unexpected permissions");
if (!same(manifest.host_permissions, ["https://meet.google.com/*"])) {
  problems.push("unexpected host_permissions");
}
for (const key of ["web_accessible_resources", "optional_permissions", "externally_connectable"]) {
  if (key in manifest) problems.push(`manifest has ${key}`);
}

if (problems.length > 0) {
  console.error(`Release build check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Release build check passed.");
