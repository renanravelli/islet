import { afterEach, describe, expect, it, vi } from "vitest";
import script from "../scripts/capture-snapshot.js?raw";
import { MeetAdapter } from "../src/content/meet/adapter";
import { FIXTURES, load } from "./dom";

async function capture(names: string): Promise<string> {
  let blob: Blob | undefined;
  vi.stubGlobal("prompt", () => names);
  URL.createObjectURL = (b: Blob) => {
    blob = b;
    return "blob:snapshot";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "table").mockImplementation(() => {});
  // The script is meant to be pasted into DevTools; run it the same way.
  new Function(script)();
  if (!blob) throw new Error("nothing was saved");
  return blob.text();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("capture-snapshot.js", () => {
  it("removes names, text, meeting codes and the chat", async () => {
    load(FIXTURES.inCallEn);
    document
      .querySelector("[data-meeting-title]")
      ?.setAttribute("data-meeting-title", "abc-defg-hij");
    const html = await capture("Alex Example, Sam Example");
    for (const secret of ["Alex", "Sam", "Synthetic design review", "chat line", "abc-defg-hij"]) {
      expect(html).not.toContain(secret);
    }
    expect(html).toContain("chat panel removed");
  });

  it("keeps what calibration needs", async () => {
    load(FIXTURES.inCallEn);
    const html = await capture("");
    // Control labels and state attributes survive, so selectors can be checked against it.
    load(html);
    const { state } = new MeetAdapter(document).readState();
    expect(state.self).toEqual({ mic: "on", cam: "off", hand: "off" });
    expect(new MeetAdapter(document).detectInCall()).toBe(true);
  });

  it("does nothing when cancelled", () => {
    vi.stubGlobal("prompt", () => null);
    const saved = vi.fn();
    URL.createObjectURL = saved;
    new Function(script)();
    expect(saved).not.toHaveBeenCalled();
  });
});
