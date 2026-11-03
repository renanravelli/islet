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
  ["the calibration runner", /calibration-report|meet-real-|isletContinue/],
  ["the snapshot code", /calibration snapshot/],
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

// The script in Meet's own world (ADR 0005) only reschedules animation frames: no extension
// APIs, no messaging, no DOM reads.
const PAGE_WORLD_FORBIDDEN =
  /\bchrome\.|postMessage|querySelector|getElementBy|innerText|textContent/;
for (const script of manifest.content_scripts ?? []) {
  if (script.world !== "MAIN") continue;
  for (const file of script.js ?? []) {
    if (PAGE_WORLD_FORBIDDEN.test(readFileSync(join(dist, file), "utf8"))) {
      problems.push(`${file} runs in Meet's world and does more than schedule frames`);
    }
  }
}
const pageWorld = (manifest.content_scripts ?? []).filter((s) => s.world === "MAIN").length;
if (pageWorld > 1) problems.push("more than one content script in Meet's world");

if (problems.length > 0) {
  console.error(`Release build check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Release build check passed.");
