import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_TIMEOUT_MS, MeetAdapter, meetingCode } from "../src/content/meet/adapter";
import { SELECTORS } from "../src/content/meet/selectors";
import { button, FIXTURES, load } from "./dom";

const adapter = () => new MeetAdapter(document);

describe("detectInCall", () => {
  it("is true in a call and false in the lobby", () => {
    load(FIXTURES.inCallEn);
    expect(adapter().detectInCall()).toBe(true);
    load(FIXTURES.inCallPtBr);
    expect(adapter().detectInCall()).toBe(true);
    load(FIXTURES.lobby);
    expect(adapter().detectInCall()).toBe(false);
  });
});

describe("readState", () => {
  it("reads every field of an English call", () => {
    load(FIXTURES.inCallEn);
    const { state, failed } = adapter().readState();
    expect(failed).toEqual([]);
    expect(state).toEqual({
      meeting_code: "abc-defg-hij",
      title: "Synthetic design review",
      self: { mic: "on", cam: "off", hand: "off" },
      active_speaker: { display_name: "Alex Example" },
      participant_count: 5,
      participants: [{ display_name: "Alex Example" }, { display_name: "Sam Example" }],
      signals: { speaking_while_muted: false },
      capabilities: ["toggle_mic", "toggle_cam", "toggle_hand", "leave", "focus_tab"],
      health: "ok",
    });
  });

  it("falls back to pt-BR aria-labels", () => {
    load(FIXTURES.inCallPtBr);
    const { state } = adapter().readState();
    expect(state.self).toEqual({ mic: "off", cam: "on", hand: "on" });
    expect(state.participant_count).toBe(3);
    expect(state.signals.speaking_while_muted).toBe(true);
    // Nobody is speaking and there is no title: neither is a failure.
    expect(state.active_speaker).toBeUndefined();
    expect(state.title).toBeUndefined();
    expect(state.health).toBe("ok");
  });

  it("reports what it cannot read instead of guessing", () => {
    load(FIXTURES.degraded);
    const { state, failed } = adapter().readState();
    expect(state.self).toEqual({ mic: "unknown", cam: "unknown", hand: "unknown" });
    expect(state.health).toBe("degraded");
    expect(state.degraded_reasons).toEqual([
      "mic_button",
      "cam_button",
      "hand_button",
      "participant_count",
    ]);
    expect(failed).toEqual(["micButton", "camButton", "handButton", "participantCount"]);
    // Only controls it found are offered: the camera button exists even if its state is unclear.
    expect(state.capabilities).toEqual(["toggle_cam", "leave", "focus_tab"]);
  });

  it("never reads the chat", () => {
    load(FIXTURES.inCallEn);
    expect(JSON.stringify(adapter().readState())).not.toContain("chat line");
  });

  it("shows the meeting code as the title in an instant meeting, as Meet does", () => {
    load(FIXTURES.inCallEn);
    const title = document.querySelector("[jsname=NeC6gb]");
    if (title) title.textContent = "abc-defg-hij";
    const { state, failed } = adapter().readState();
    expect(state.title).toBe("abc-defg-hij");
    expect(failed).toEqual([]);
  });

  it("names up to three participants, each once, in page order", () => {
    load(FIXTURES.inCallEn);
    const toolbar = document.querySelector("[role=toolbar]");
    for (const name of ["Sam Example", "Jo Example", "Kim Example"]) {
      const tile = document.createElement("div");
      tile.setAttribute("data-participant-id", name);
      tile.innerHTML = `<span class="notranslate">${name}</span>`;
      toolbar?.before(tile);
    }
    expect(adapter().readState().state.participants).toEqual([
      { display_name: "Alex Example" },
      { display_name: "Sam Example" },
      { display_name: "Jo Example" },
    ]);
  });

  it("keeps names and titles short", () => {
    load(FIXTURES.inCallEn);
    const title = document.querySelector("[jsname=NeC6gb]");
    if (title) title.textContent = "x".repeat(500);
    expect(adapter().readState().state.title).toHaveLength(200);
  });
});

describe("meetingCode", () => {
  it("takes the code from the path", () => {
    expect(meetingCode("/abc-defg-hij")).toBe("abc-defg-hij");
    expect(meetingCode("/abc-defg-hij/extra")).toBe("abc-defg-hij");
    expect(meetingCode("/lookup/some-name")).toBe("lookup");
    expect(meetingCode("/")).toBe("");
  });
});

describe("execute", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("confirms a toggle once the page shows the change", async () => {
    load(FIXTURES.inCallEn);
    const mic = button(/microphone/);
    mic.addEventListener("click", () =>
      setTimeout(() => {
        mic.setAttribute("data-is-muted", "true");
        mic.setAttribute("aria-label", "Turn on microphone (⌘ + d)");
      }, 300),
    );
    const result = adapter().execute("toggle_mic");
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toBeNull();
  });

  it("reports not_confirmed when nothing changes within 1.5 s", async () => {
    load(FIXTURES.inCallEn);
    const clicked = vi.fn();
    button(/raise hand/i).addEventListener("click", clicked);
    const result = adapter().execute("toggle_hand");
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + 100);
    expect(await result).toBe("not_confirmed");
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("reports control_not_found without clicking anything", async () => {
    load(FIXTURES.degraded);
    expect(await adapter().execute("toggle_mic")).toBe("control_not_found");
    expect(await adapter().execute("toggle_hand")).toBe("control_not_found");
  });

  it("answers the host's leave dialog by only leaving, never ending the call for everyone", async () => {
    load(FIXTURES.inCallPtBr);
    let endedForEveryone = false;
    button(/sair da chamada/i).addEventListener("click", () =>
      setTimeout(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div role="dialog"><button id="end-all">Encerrar a chamada para todos</button><button id="leave">Sair da chamada</button></div>`,
        );
        document
          .getElementById("leave")
          ?.addEventListener("click", () =>
            setTimeout(() => load("<main><p>Você saiu da reunião</p></main>"), 200),
          );
        document.getElementById("end-all")?.addEventListener("click", () => {
          endedForEveryone = true;
        });
      }, 300),
    );
    const result = adapter().execute("leave");
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS);
    expect(await result).toBeNull();
    expect(endedForEveryone).toBe(false);
  });

  it("refuses to click a control that ends the call for everyone, whatever the selectors say", async () => {
    load(FIXTURES.inCallPtBr);
    // A broken registry whose "just leave" strategy points at the wrong button.
    const keys = {
      ...SELECTORS.keys,
      justLeaveButton: { ...SELECTORS.keys.justLeaveButton, strategies: [{ css: "#end-all" }] },
    };
    const clicked = vi.fn();
    button(/sair da chamada/i).addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog"><button id="end-all">Encerrar a chamada para todos</button></div>`,
      );
      document.getElementById("end-all")?.addEventListener("click", clicked);
    });
    const result = new MeetAdapter(document, { ...SELECTORS, keys }).execute("leave");
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + 100);
    expect(await result).toBe("not_confirmed");
    expect(clicked).not.toHaveBeenCalled();
  });

  it("leaves a dialog it does not recognize for the person to answer", async () => {
    load(FIXTURES.inCallEn);
    const clicked = vi.fn();
    button(/leave call/i).addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div role="dialog"><button id="other">Something new</button></div>`,
      );
      document.getElementById("other")?.addEventListener("click", clicked);
    });
    const result = adapter().execute("leave");
    await vi.advanceTimersByTimeAsync(CONFIRM_TIMEOUT_MS + 100);
    expect(await result).toBe("not_confirmed");
    expect(clicked).not.toHaveBeenCalled();
  });

  it("confirms leaving once the call is gone", async () => {
    load(FIXTURES.inCallEn);
    button(/leave call/i).addEventListener("click", () =>
      setTimeout(() => {
        document.body.innerHTML = "<main><p>You left the meeting</p></main>";
      }, 200),
    );
    const result = adapter().execute("leave");
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toBeNull();
  });
});
