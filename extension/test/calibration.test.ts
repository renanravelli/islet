import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sessionDoc from "../../docs/meet-adapter/calibration-session.md?raw";
import { MeetAdapter } from "../src/content/meet/adapter";
import {
  continueCalibration,
  detectLocale,
  type Report,
  runCalibration,
} from "../src/debug/calibration";
import { STEPS } from "../src/debug/steps";
import { FIXTURES, load } from "./dom";

const LEFT_PAGE = "<main><h1>You left the meeting</h1><button>Rejoin</button></main>";
const NAMES = "Alex Example, Sam Example";

interface Saved {
  name: string;
  content: string;
}

/** A tiny fake Meet: buttons that react to clicks like Meet would, after a short delay. */
function wireButtons(): void {
  const toggle = (
    jsname: string,
    on: string,
    off: string,
    attr: "data-is-muted" | "aria-pressed",
  ) => {
    const el = document.querySelector(`[jsname='${jsname}']`);
    el?.addEventListener("click", () =>
      setTimeout(() => {
        const wasOn =
          attr === "data-is-muted"
            ? el.getAttribute(attr) === "false"
            : el.getAttribute(attr) === "true";
        el.setAttribute(attr, attr === "data-is-muted" ? String(wasOn) : String(!wasOn));
        el.setAttribute("aria-label", wasOn ? on : off);
      }, 200),
    );
  };
  toggle("hw0c9", "Turn on microphone", "Turn off microphone", "data-is-muted");
  toggle("psRWwc", "Turn on camera", "Turn off camera", "data-is-muted");
  toggle("FpSaz", "Raise hand", "Lower hand", "aria-pressed");
  // Meet asks the host before leaving.
  document.querySelector("[jsname='CQylAd']")?.addEventListener("click", () =>
    setTimeout(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog"><button id="just-leave">Just leave the call</button><button id="end-all">End the call for everyone</button></div>`,
      );
      document
        .getElementById("just-leave")
        ?.addEventListener("click", () => setTimeout(() => load(LEFT_PAGE), 200));
      document.getElementById("end-all")?.addEventListener("click", () => {
        endedForEveryone = true;
      });
    }, 300),
  );
}

let endedForEveryone = false;

function joinCall(): void {
  load(FIXTURES.inCallEn);
  document.documentElement.lang = "en";
  // Nobody speaks until the iPhone is asked to.
  for (const ring of document.querySelectorAll("[jsname='QgSmzd']")) ring.className = "gjg47c";
  const count = document.querySelector(".fs3avc");
  if (count) count.textContent = "1";
  wireButtons();
}

/** Plays the person and the iPhone: reacts to each console instruction. */
function respond(message: string): void {
  const later = (ms: number, act: () => void) => setTimeout(act, ms);
  if (message.includes("Join the call on the Mac")) later(1000, joinCall);
  if (message.includes("Join from the iPhone")) {
    later(1500, () => {
      const count = document.querySelector(".fs3avc");
      if (count) count.textContent = "2";
    });
  }
  if (message.includes("raise the hand")) {
    later(1000, () =>
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="status" id="hand">Sam Example raised a hand</div>`,
      ),
    );
  }
  if (message.includes("Lower the iPhone's hand")) document.getElementById("hand")?.remove();
  if (message.includes("keep talking with the mic off")) {
    later(1000, () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="alert" id="notice">Are you talking? Turn on your mic</div>`,
      );
      setTimeout(() => document.getElementById("notice")?.remove(), 2300);
    });
  }
  const ring = (tile: string, speaking: boolean) => {
    const el = document.querySelector(`[data-participant-id='${tile}'] [jsname='QgSmzd']`);
    if (el) el.className = speaking ? "wEsLMd" : "gjg47c";
  };
  if (message.includes("keep talking with the mic on")) later(1000, () => ring("p1", true));
  if (message.includes("Stop talking on the Mac")) ring("p1", false);
  if (message.includes("Mute the iPhone")) ring("p2", false);
  if (message.includes("Unmute the iPhone")) {
    later(1000, () => {
      const ring = document.querySelector("[data-participant-id='p2'] [jsname='QgSmzd']");
      if (ring) ring.className = "wEsLMd";
    });
  }
  if (message.includes("answer it by hand")) later(1000, () => load(LEFT_PAGE));
}

async function drive<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  for (let i = 0; i < 10_000 && !done; i++) await vi.advanceTimersByTimeAsync(100);
  return promise;
}

let saved: Saved[];
let warnings: string[];

function deps(react = respond) {
  return {
    adapter: new MeetAdapter(document),
    prompt: () => NAMES,
    save: (name: string, content: string) => void saved.push({ name, content }),
    log: {
      info: (message: string) => react(message),
      warn: (message: string) => void warnings.push(message),
      log() {},
      group() {},
      groupEnd() {},
      table() {},
    },
  };
}

beforeEach(() => {
  endedForEveryone = false;
  vi.useFakeTimers();
  saved = [];
  warnings = [];
});
afterEach(() => vi.useRealTimers());

describe("runCalibration", () => {
  it("runs the whole session, asking only for physical actions", async () => {
    load(FIXTURES.lobby);
    document.documentElement.lang = "en";
    const reports = (await drive(runCalibration(undefined, deps()))) as Report[];

    expect(saved.map((f) => f.name)).toEqual([
      ...[
        "lobby",
        "in-call-mic-on",
        "in-call-mic-off",
        "remote-hand",
        "silence",
        "speaking-mac",
        "speaking",
        "muted-speaking",
      ].flatMap((id) => [
        `meet-real-${id}.en.html`,
        `meet-real-${id}.en.expected.json`,
        `meet-real-${id}.en.observed.json`,
      ]),
      "calibration-report.en.json",
      "meet-real-left.en.html",
      "meet-real-left.en.expected.json",
      "meet-real-left.en.observed.json",
      "calibration-report.en.after-leave.json",
    ]);

    const [main, afterLeave] = reports;
    if (!main || !afterLeave) throw new Error("two reports expected");
    const step = (report: Report, id: string) => {
      const found = report.steps.find((s) => s.id === id);
      if (!found) throw new Error(`no step ${id}`);
      return found;
    };
    for (const s of main.steps) {
      expect(s.mismatches ?? [], s.id).toEqual([]);
      for (const wait of s.waits) expect(wait.status, `${s.id}: ${wait.ask}`).toBe("met");
    }
    expect(step(main, "in-call-mic-off").set.map((s) => s.outcome)).toEqual([
      "set through execute",
      "set through execute",
      "set through execute",
    ]);
    expect(step(main, "commands").commands.map((c) => [c.action, c.result, c.after])).toEqual([
      ["toggle_mic", "confirmed", "on"],
      ["toggle_cam", "confirmed", "off"],
      ["toggle_hand", "confirmed", "off"],
    ]);
    expect(step(main, "remote-hand").observed?.remoteHand).toBe(true);
    const notice = step(main, "muted-speaking").measurements.noticeVisibleMs as number;
    expect(notice).toBeGreaterThanOrEqual(2200);
    expect(notice).toBeLessThanOrEqual(2600);
    expect(step(main, "speaking").measurements.speaker).toMatchObject({
      present: 20,
      changes: 0,
      distinctSpeakers: 1,
      distinctSpeakingTiles: 1,
    });
    // Who speaks, by tile position: nobody, then the Mac's tile, then the iPhone's.
    expect(step(main, "silence").observed?.speakingTiles).toEqual([]);
    expect(step(main, "silence").measurements.speaker).toMatchObject({ present: 0 });
    expect(step(main, "speaking-mac").observed?.speakingTiles).toEqual([0]);
    expect(step(main, "speaking").observed?.speakingTiles).toEqual([1]);
    expect(step(main, "muted-speaking").measurements.noticeTexts).toEqual([
      "Are you talking? Turn on your mic",
    ]);
    expect(step(main, "in-call-mic-on").find?.micButton).toMatchObject({
      strategy: 0,
      tag: "button",
      jsname: "hw0c9",
      data: { "data-is-muted": "false" },
    });
    expect(step(main, "in-call-mic-on").observed?.avatarCount).toBe(3);

    expect(step(afterLeave, "leave").dialog).toEqual({
      buttons: ["Just leave the call", "End the call for everyone"],
    });
    // Islet answered the host's dialog by only leaving: no question for the person, no
    // call ended for everyone.
    expect(step(afterLeave, "leave").commands[0]).toMatchObject({
      action: "leave",
      result: "confirmed",
    });
    expect(step(afterLeave, "leave").waits).toEqual([]);
    expect(endedForEveryone).toBe(false);
    expect(step(afterLeave, "left").observed?.inCall).toBe(false);
  });

  it("never saves names, titles or meeting codes", async () => {
    load(FIXTURES.lobby);
    document.documentElement.lang = "en";
    await drive(runCalibration(undefined, deps()));
    expect(saved.length).toBeGreaterThan(0);
    for (const { name, content } of saved) {
      for (const secret of ["Alex", "Sam", "Synthetic design review", "abc-defg-hij"]) {
        expect(content, `${name} contains ${secret}`).not.toContain(secret);
      }
    }
    const observed = saved.find((f) => f.name === "meet-real-speaking.en.observed.json");
    expect(JSON.parse(observed?.content ?? "{}").state.active_speaker).toEqual({
      display_name: "[name]",
    });
  });

  it('runs the short session with runCalibration("short")', async () => {
    joinCall();
    const reports = (await drive(runCalibration("short", deps()))) as Report[];
    expect(saved.map((f) => f.name)).toEqual([
      ...["in-call-mic-on", "silence", "speaking-mac", "speaking", "muted-speaking"].flatMap(
        (id) => [
          `meet-real-${id}.en.html`,
          `meet-real-${id}.en.expected.json`,
          `meet-real-${id}.en.observed.json`,
        ],
      ),
      "calibration-report.en.short.json",
      "meet-real-left.en.html",
      "meet-real-left.en.expected.json",
      "meet-real-left.en.observed.json",
      "calibration-report.en.short.after-leave.json",
    ]);
    for (const report of reports) {
      for (const s of report.steps) expect(s.mismatches ?? [], s.id).toEqual([]);
    }
    expect(endedForEveryone).toBe(false);
  });

  it("skips the lobby when started in a call, and can capture it on its own", async () => {
    joinCall();
    const [report] = (await drive(runCalibration("lobby", deps()))) as Report[];
    expect(report?.steps[0]?.status).toBe("skipped");
    expect(report?.steps[0]?.note).toContain('runCalibration("lobby")');

    load(FIXTURES.lobby);
    document.documentElement.lang = "pt-BR";
    saved = [];
    await drive(runCalibration("lobby", deps()));
    expect(saved.map((f) => f.name)).toEqual([
      "meet-real-lobby.pt-BR.html",
      "meet-real-lobby.pt-BR.expected.json",
      "meet-real-lobby.pt-BR.observed.json",
      "calibration-report.pt-BR.lobby.json",
    ]);
  });

  it("moves on after a timeout, or when told to with isletContinue()", async () => {
    joinCall();
    const ignored = (message: string) => {
      // Nobody talks: the notice never appears. Continue by hand on the second try.
      if (message.includes("keep talking") && continueAfter)
        setTimeout(() => continueCalibration(), 2000);
    };
    let continueAfter = false;
    const [first] = (await drive(runCalibration("muted-speaking", deps(ignored)))) as Report[];
    expect(first?.steps[0]?.waits.at(-1)?.status).toBe("timeout");
    expect(first?.steps[0]?.measurements.noticeVisibleMs).toContain("not measured");
    expect(warnings.some((w) => w.includes("not detected"))).toBe(true);

    continueAfter = true;
    const [second] = (await drive(runCalibration("muted-speaking", deps(ignored)))) as Report[];
    expect(second?.steps[0]?.waits.at(-1)).toMatchObject({ status: "continued" });
    expect(second?.steps[0]?.mismatches).toEqual([
      { field: "speaking_while_muted", expected: true, observed: false },
    ]);
  });

  it("asks to set a state by hand when it cannot read it", async () => {
    joinCall();
    document.querySelector("[jsname='FpSaz']")?.removeAttribute("aria-pressed");
    document.querySelector("[jsname='FpSaz']")?.setAttribute("aria-label", "Hand options");
    const asked: string[] = [];
    await drive(
      runCalibration(
        "in-call-mic-off",
        deps((message) => {
          asked.push(message);
          if (message.includes("cannot read the hand"))
            setTimeout(() => continueCalibration(), 500);
        }),
      ),
    );
    expect(
      asked.some((m) => m.includes("Islet cannot read the hand. Make sure it is up on the Mac")),
    ).toBe(true);
  });

  it("refuses unknown entries", async () => {
    expect(await runCalibration("teleport", deps())).toBeUndefined();
    expect(warnings.at(-1)).toContain("in-call-mic-on");
  });

  it("detects the locale from the page", () => {
    for (const [lang, locale] of [
      ["pt-BR", "pt-BR"],
      ["pt", "pt-BR"],
      ["en-US", "en"],
      ["", "unknown"],
    ]) {
      document.documentElement.lang = lang ?? "";
      expect(detectLocale(document)).toBe(locale);
    }
  });
});

describe("calibration-session.md", () => {
  const sections = sessionDoc.split(/^### /m).slice(1);

  it("describes exactly the runner's steps", () => {
    const headings = sections.map((s) => s.split("\n")[0]);
    expect(headings).toEqual(STEPS.map((step) => `${step.number}. ${step.title}`));
  });

  for (const step of STEPS) {
    it(`step ${step.number} matches: ${step.title}`, () => {
      const section = sections.find((s) => s.startsWith(`${step.number}. ${step.title}`)) ?? "";
      if (step.actions.some((a) => a.kind === "capture")) {
        expect(section).toContain(`meet-real-${step.id}.<locale>.html`);
      }
      const expected = /\*\*Expected:\*\* `(\{.*\})`/.exec(section)?.[1];
      expect(expected ? JSON.parse(expected) : undefined).toEqual(step.expected);
      for (const action of step.actions) {
        if (action.kind === "wait") expect(section).toContain(action.ask);
        if (action.kind === "tell" || action.kind === "pause")
          expect(section).toContain(action.text);
      }
    });
  }
});
