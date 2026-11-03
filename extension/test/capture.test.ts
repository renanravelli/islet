import { afterEach, describe, expect, it, vi } from "vitest";
import runnerLauncher from "../scripts/calibration-runner.js?raw";
import captureLauncher from "../scripts/capture-snapshot.js?raw";
import { MeetAdapter } from "../src/content/meet/adapter";
import { captureSnapshot, snapshot } from "../src/debug/snapshot";
import { FIXTURES, load } from "./dom";

/** Sensitive things a real Meet page has and the synthetic fixture lacks. */
function addRealWorldNoise(): void {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="unrelated">Unrelated page text by Alex Example</div>
     <script>window.secret = "token"</script>
     <style>.x { color: red }</style>`,
  );
  const tile = document.querySelector("[data-participant-id='p1']");
  tile?.insertAdjacentHTML(
    "beforeend",
    `<img src="https://lh3.googleusercontent.com/a/avatar=s64" alt="Alex Example">
     <div data-avatar-url="https://lh3.googleusercontent.com/a/x" data-requested-id="spaces/AbC123xyz/devices/42"
          title="Alex Example (you)" style="background:url(//lh3.googleusercontent.com/x)">tile</div>
     <svg><path d="${"M0 0L1 1".repeat(60)}"></path></svg>`,
  );
  tile?.setAttribute("data-participant-id", "spaces/AbC123xyz/devices/42");
  tile?.setAttribute("jslog", "1234; track:impression");
  document.querySelector("[jsname='NeC6gb']")?.append(" abc-defg-hij");
  document.querySelector("[role='toolbar']")?.insertAdjacentHTML(
    "beforeend",
    `<button aria-label="Pin Alex Example to your main screen" data-tooltip-id="tt-9"></button>
       <button aria-label="Share alex@example.com"></button>`,
  );
}

const silent = { group() {}, groupEnd() {}, log() {}, table() {} };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { isletDebug?: unknown }).isletDebug;
});

describe("snapshot", () => {
  it("removes names, text, URLs, IDs, scripts, styles, images and the chat", () => {
    load(FIXTURES.inCallEn);
    addRealWorldNoise();
    const { html } = snapshot({ names: ["Alex Example", "Sam Example"] });
    for (const secret of [
      "Alex",
      "Sam",
      "alex@example.com",
      "Synthetic design review",
      "chat line",
      "In-call messages",
      "abc-defg-hij",
      "googleusercontent",
      "AbC123xyz",
      "token",
      "color: red",
      "Unrelated page text",
      "M0 0L1 1",
      "jslog",
      "data-avatar-url",
      "data-requested-id",
      "data-tooltip-id",
      " title=",
      "style=",
      "<img",
      "<script",
      "<style",
      "people-label",
    ]) {
      expect(html, secret).not.toContain(secret);
    }
    // A selector's data-* attribute survives, with its ID-like value replaced.
    expect(html).toMatch(/data-participant-id="id-\d+"/);
  });

  it("keeps the top bar, the controls and what selectors match", () => {
    load(FIXTURES.inCallEn);
    addRealWorldNoise();
    const { html, regions } = snapshot({ names: [] });
    expect(html).not.toContain('class="unrelated"');
    expect(html).toContain('jsname="NeC6gb"');
    expect(html).toContain('jsname="ocqpFe"');
    expect(html).toContain("data-avatar-count");
    expect(html).toContain('role="toolbar"');
    expect(regions.topBar).toBe(3);
  });

  it("keeps what calibration needs: states, counts, labels and their links", () => {
    load(FIXTURES.inCallEn);
    const { html } = snapshot({ names: [] });
    load(html);
    const adapter = new MeetAdapter(document);
    expect(adapter.detectInCall()).toBe(true);
    const { state, failed } = adapter.readState();
    expect(failed).toEqual([]);
    expect(state.self).toEqual({ mic: "on", cam: "off", hand: "off" });
    // The "People" label (UI text) and the number survive; the ID link is renamed, not broken.
    expect(state.participant_count).toBe(5);
    expect(state.title).toBe("[text]");
    expect(state.active_speaker).toEqual({ display_name: "[text]" });
  });

  it("keeps the text of a notice that matches selectors.json", () => {
    load(FIXTURES.inCallPtBr);
    const { html } = snapshot({ names: [] });
    expect(html).toContain("Você está falando?");
    load(html);
    expect(new MeetAdapter(document).readState().state.signals.speaking_while_muted).toBe(true);
  });

  it("empties a chat panel caught inside a kept region", () => {
    load(FIXTURES.inCallEn);
    document
      .querySelector("[role='toolbar']")
      ?.insertAdjacentHTML(
        "beforeend",
        `<div aria-label="Chat messages"><p>Synthetic message from Alex Example</p></div>`,
      );
    const { html } = snapshot({ names: [] });
    expect(html).toContain("chat panel removed");
    expect(html).not.toContain("Synthetic message");
  });
});

describe("captureSnapshot", () => {
  it("prints a summary, then saves only after confirmation in manual mode", () => {
    load(FIXTURES.inCallEn);
    addRealWorldNoise();
    const save = vi.fn();
    const table = vi.fn();
    const log = { ...silent, table };
    expect(
      captureSnapshot({ names: ["Alex Example"], auto: false, confirm: () => false, save, log }),
    ).toBeNull();
    expect(save).not.toHaveBeenCalled();
    const summary = JSON.stringify(table.mock.calls);
    for (const item of [
      "text nodes",
      "<img> elements",
      "attributes holding a URL",
      "ID-like data-* values",
      "given names",
    ]) {
      expect(summary, item).toContain(item);
    }
    expect(summary).toContain("Pin [name] to your main screen");

    captureSnapshot({ names: [], auto: false, confirm: () => true, save, log, fileName: "x.html" });
    expect(save).toHaveBeenCalledWith(
      "x.html",
      expect.stringContaining("Islet calibration snapshot"),
      "text/html",
    );
  });

  it("does not ask in auto mode, and still prints the summary", () => {
    load(FIXTURES.inCallEn);
    const confirm = vi.fn(() => false);
    const save = vi.fn();
    const table = vi.fn();
    captureSnapshot({ names: [], auto: true, confirm, save, log: { ...silent, table } });
    expect(confirm).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    expect(table).toHaveBeenCalled();
  });
});

describe("launchers", () => {
  it("refuse to run without isletDebug (a release build or the wrong console context)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    new Function(captureLauncher)();
    new Function(runnerLauncher)();
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0])).toContain("build:dev");
  });

  it("start the development build's capture and runner", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const debug = {
      captureSnapshot: vi.fn(),
      runCalibration: vi.fn(),
      continue: vi.fn(),
      selectorsVersion: 2,
    };
    Object.assign(globalThis, { isletDebug: debug });
    new Function(captureLauncher)();
    expect(debug.captureSnapshot).toHaveBeenCalledOnce();
    new Function(runnerLauncher)();
    expect(debug.runCalibration).toHaveBeenCalledOnce();
    const g = globalThis as unknown as { runCalibration(e?: string): void; isletContinue(): void };
    g.runCalibration("left");
    expect(debug.runCalibration).toHaveBeenLastCalledWith("left");
    g.isletContinue();
    expect(debug.continue).toHaveBeenCalledOnce();
  });
});
