import { afterEach, describe, expect, it, vi } from "vitest";
import script from "../scripts/capture-snapshot.js?raw";
import { MeetAdapter } from "../src/content/meet/adapter";
import { SELECTORS } from "../src/content/meet/selectors";
import { FIXTURES, load } from "./dom";

interface Run {
  html: string | undefined;
  logged: string;
}

/** Runs the script the way it is meant to be used: pasted into DevTools. */
async function capture(names: string | null, save = true): Promise<Run> {
  let blob: Blob | undefined;
  vi.stubGlobal("prompt", () => names);
  vi.stubGlobal("confirm", () => save);
  URL.createObjectURL = (b: Blob) => {
    blob = b;
    return "blob:snapshot";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const table = vi.spyOn(console, "table").mockImplementation(() => {});
  vi.spyOn(console, "group").mockImplementation(() => {});
  vi.spyOn(console, "groupEnd").mockImplementation(() => {});
  new Function(script)();
  const logged = JSON.stringify([...log.mock.calls, ...table.mock.calls]);
  return { html: await blob?.text(), logged };
}

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
  document
    .querySelector("[data-meeting-title]")
    ?.setAttribute("data-meeting-title", "abc-defg-hij");
  document.querySelector("[role='toolbar']")?.insertAdjacentHTML(
    "beforeend",
    `<button aria-label="Pin Alex Example to your main screen" data-tooltip-id="tt-9"></button>
     <button aria-label="Share alex@example.com"></button>`,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("capture-snapshot.js", () => {
  it("removes names, text, URLs, IDs, scripts, styles, images and the chat", async () => {
    load(FIXTURES.inCallEn);
    addRealWorldNoise();
    const { html } = await capture("Alex Example, Sam Example");
    expect(html).toBeDefined();
    for (const secret of [
      "Alex",
      "Sam",
      "alex@example.com",
      "Synthetic design review",
      "chat line",
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
    ]) {
      expect(html, secret).not.toContain(secret);
    }
    // The chat panel is not one of the kept regions, so none of it is copied.
    expect(html).not.toContain("In-call messages");
    // A selector's data-* attribute survives, with its ID-like value replaced.
    expect(html).toContain('data-participant-id="id-1"');
  });

  it("keeps only the relevant regions", async () => {
    load(FIXTURES.inCallEn);
    addRealWorldNoise();
    const { html = "" } = await capture("");
    expect(html).not.toContain('class="unrelated"');
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("data-meeting-title");
    expect(html).toContain("data-speaking");
  });

  it("keeps what calibration needs", async () => {
    load(FIXTURES.inCallEn);
    const { html = "" } = await capture("");
    load(html);
    const adapter = new MeetAdapter(document);
    expect(adapter.detectInCall()).toBe(true);
    const { state } = adapter.readState();
    expect(state.self).toEqual({ mic: "on", cam: "off", hand: "off" });
    expect(state.participant_count).toBe(5); // short numbers survive
    expect(state.active_speaker).toEqual({ display_name: "[text]" });
  });

  it("keeps the text of a notice that matches selectors.json, scrubbed", async () => {
    load(FIXTURES.inCallPtBr);
    const { html = "" } = await capture("");
    expect(html).toContain("Você está falando?");
    load(html);
    expect(new MeetAdapter(document).readState().state.signals.speaking_while_muted).toBe(true);
  });

  it("shows a summary of what it removed before asking to save", async () => {
    load(FIXTURES.inCallEn);
    addRealWorldNoise();
    const { logged } = await capture("Alex Example");
    for (const item of [
      "text nodes",
      "<img> elements",
      "attributes holding a URL",
      "ID-like data-* values",
      "typed names",
    ]) {
      expect(logged, item).toContain(item);
    }
    expect(logged).toContain("Pin [name] to your main screen");
  });

  it("empties a chat panel caught inside a kept region", async () => {
    load(FIXTURES.inCallEn);
    document
      .querySelector("[role='toolbar']")
      ?.insertAdjacentHTML(
        "beforeend",
        `<div aria-label="Chat messages"><p>Synthetic message from Alex Example</p></div>`,
      );
    const { html = "" } = await capture("");
    expect(html).toContain("chat panel removed");
    expect(html).not.toContain("Synthetic message");
  });

  it("saves nothing when cancelled at either question", async () => {
    load(FIXTURES.inCallEn);
    expect((await capture(null)).html).toBeUndefined();
    expect((await capture("", false)).html).toBeUndefined();
  });

  it("knows every data-* attribute and notice pattern selectors.json uses", () => {
    const list = (name: string): string[] => {
      const match = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`).exec(script);
      if (!match?.[1]) throw new Error(`${name} not found`);
      return JSON.parse(match[1].replace(/,\s*\]/, "]"));
    };
    const used = [...new Set(JSON.stringify(SELECTORS.keys).match(/data-[a-z0-9-]+/g))].sort();
    expect(list("SELECTOR_DATA_ATTRIBUTES").sort()).toEqual(used);

    const notice = SELECTORS.keys.mutedSpeakingNotice.strategies.flatMap((s) =>
      "text" in s ? Object.values(s.text) : [],
    );
    expect(list("NOTICE_PATTERNS").sort()).toEqual(notice.sort());
  });
});
