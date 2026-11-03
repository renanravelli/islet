// Fails if any fixture holds personal data. Runs locally and in CI (`pnpm test`).
//
// Names: put one name per line in extension/test/.private-names.txt (git-ignored; lines starting
// with # are comments): yours and those of everyone in your calibration calls. Without the file,
// for example in CI, only the generic patterns are checked.

import { describe, expect, it } from "vitest";

const fixtures = import.meta.glob<string>("./fixtures/**/*", {
  eager: true,
  query: "?raw",
  import: "default",
});
const privateNames = Object.values(
  import.meta.glob<string>("./.private-names.txt", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
)[0];

const PATTERNS: [string, RegExp][] = [
  ["an e-mail address", /[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}/i],
  ["a googleusercontent.com URL", /googleusercontent\.com/i],
  ["a meeting code", /\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/i],
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (privateNames ?? "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 1 && !line.startsWith("#"));

describe("fixtures are sanitized", () => {
  it("found the fixtures", () => {
    expect(Object.keys(fixtures).length).toBeGreaterThan(0);
  });

  for (const [path, content] of Object.entries(fixtures)) {
    it(path, () => {
      for (const [what, pattern] of PATTERNS) {
        const match = pattern.exec(content);
        expect(match, `${path} contains ${what}`).toBeNull();
      }
      for (const name of names) {
        // Whole words only, any case: "Ana" must not flag "Analysis".
        const pattern = new RegExp(`(?<!\\p{L})${escapeRegExp(name)}(?!\\p{L})`, "iu");
        expect(pattern.test(content), `${path} contains a name from .private-names.txt`).toBe(
          false,
        );
      }
    });
  }

  it.skipIf(privateNames === undefined)("checks the names in .private-names.txt", () => {
    expect(names.length).toBeGreaterThan(0);
  });
});
