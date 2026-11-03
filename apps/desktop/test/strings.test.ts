import { describe, expect, it } from "vitest";
import spec from "../../../docs/design/ui-spec.md?raw";
import { parseStrings } from "../src/i18n/parse.mjs";
import strings from "../src/i18n/strings.json";

const sources = import.meta.glob<string>("../src/**/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("UI strings", () => {
  it("strings.json is exactly section 6 of the UI spec (run `pnpm strings` after editing it)", () => {
    expect(strings).toEqual(parseStrings(spec));
  });

  it("every key exists in both locales", () => {
    expect(Object.keys(strings["pt-BR"]).sort()).toEqual(Object.keys(strings.en).sort());
  });

  // UI copy lives in the dictionary. Names that are not copy (product and language names) are
  // constants in src/shared/meet.ts, rendered through {…}.
  for (const [path, source] of Object.entries(sources)) {
    if (path.includes("/gallery/")) continue;
    it(`${path} has no hard-coded text`, () => {
      const jsxText = [...source.matchAll(/>\s*([^<>{}\s][^<>{}]*?)\s*</g)]
        .map((m) => m[1] ?? "")
        .filter((text) => /\p{L}{2,}/u.test(text) && !/[=;()]|=>/.test(text));
      expect(jsxText).toEqual([]);
    });
  }
});
