// Generates src/i18n/strings.json from section 6 of docs/design/ui-spec.md, the only source of
// UI copy. Run `pnpm --filter @islet/desktop strings` after the spec changes; a test fails if
// the two differ.

import { readFileSync, writeFileSync } from "node:fs";
import { parseStrings } from "../src/i18n/parse.mjs";

const spec = readFileSync(new URL("../../../docs/design/ui-spec.md", import.meta.url), "utf8");
const out = new URL("../src/i18n/strings.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(parseStrings(spec), null, 2)}\n`);
console.log(`Wrote ${out.pathname}`);
