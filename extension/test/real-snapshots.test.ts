// Runs the adapter against real, anonymized Meet snapshots once calibration adds them
// (docs/meet-adapter/calibration.md). Until then there are none and this suite is skipped.
//
// Each test/fixtures/meet-real-<name>.html needs a meet-real-<name>.expected.json written by
// the person who captured it, describing what the page showed at that moment.

import { describe, expect, it } from "vitest";
import { MeetAdapter } from "../src/content/meet/adapter";
import { load } from "./dom";

interface Expected {
  inCall: boolean;
  self?: { mic: string; cam: string; hand: string };
  participant_count?: number;
  /** Someone was speaking (and names were redacted, so only presence is checked). */
  speaking?: boolean;
  speaking_while_muted?: boolean;
}

const snapshots = import.meta.glob<string>("./fixtures/meet-real-*.html", {
  eager: true,
  query: "?raw",
  import: "default",
});
const expectations = import.meta.glob<Expected>("./fixtures/meet-real-*.expected.json", {
  eager: true,
  import: "default",
});

const cases = Object.entries(snapshots).map(([path, html]) => {
  const expected = expectations[path.replace(/\.html$/, ".expected.json")];
  return { path, html, expected };
});

describe.skipIf(cases.length === 0)("real Meet snapshots", () => {
  for (const { path, html, expected } of cases) {
    it(path, () => {
      expect(expected, `${path} needs an .expected.json`).toBeDefined();
      if (!expected) return;
      load(html);
      const adapter = new MeetAdapter(document);
      expect(adapter.detectInCall()).toBe(expected.inCall);
      if (!expected.inCall) return;
      const { state } = adapter.readState();
      if (expected.self) expect(state.self).toEqual(expected.self);
      if (expected.participant_count !== undefined) {
        expect(state.participant_count).toBe(expected.participant_count);
      }
      if (expected.speaking !== undefined)
        expect(state.active_speaker !== undefined).toBe(expected.speaking);
      if (expected.speaking_while_muted !== undefined) {
        expect(state.signals.speaking_while_muted).toBe(expected.speaking_while_muted);
      }
    });
  }
});
