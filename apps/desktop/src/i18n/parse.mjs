// Parses the string tables in section 6 of docs/design/ui-spec.md: rows of
// | `key` | pt-BR | en |. Shared by the generator and the test that checks it.

/** @param {string} spec @returns {{ "pt-BR": Record<string, string>, en: Record<string, string> }} */
export function parseStrings(spec) {
  const start = spec.indexOf("## 6. Strings");
  const end = spec.indexOf("\n## ", start + 1);
  if (start < 0) throw new Error("section 6 not found in the UI spec");
  const section = spec.slice(start, end < 0 ? undefined : end);
  const strings = { "pt-BR": {}, en: {} };
  for (const line of section.split("\n")) {
    const match = /^\|\s*`([a-z0-9_.]+)`\s*\|(.*)\|(.*)\|\s*$/.exec(line);
    if (!match) continue;
    const [, key, pt, en] = match;
    if (key in strings.en) throw new Error(`duplicate string key ${key}`);
    strings["pt-BR"][key] = pt.trim();
    strings.en[key] = en.trim();
  }
  for (const locale of ["pt-BR", "en"]) {
    strings[locale] = Object.fromEntries(
      Object.entries(strings[locale]).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return strings;
}
