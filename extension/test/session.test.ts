import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetAdapter } from "../src/content/meet/adapter";
import { DEBOUNCE_MS, HEARTBEAT_MS, MeetSession } from "../src/content/meet/session";
import type { TabToWorker } from "../src/shared/messages";
import { button, FIXTURES, load } from "./dom";

let sent: TabToWorker[];
let session: MeetSession;

function start(html: string): void {
  load(html);
  sent = [];
  session = new MeetSession(
    new MeetAdapter(document),
    document,
    (m) => sent.push(m),
    () => 1_793_700_000_000,
  );
  session.start();
}

const updates = () => sent.filter((m) => m.kind === "update");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  session.stop();
  vi.useRealTimers();
});

describe("MeetSession", () => {
  it("reports a call at once, with when it started", () => {
    start(FIXTURES.inCallEn);
    expect(sent).toHaveLength(1);
    const [first] = updates();
    expect(first?.kind === "update" && first.state.started_at).toBe(1_793_700_000_000);
  });

  it("says nothing in the lobby", async () => {
    start(FIXTURES.lobby);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    expect(sent).toEqual([]);
  });

  it("debounces changes and sends only real changes", async () => {
    start(FIXTURES.inCallEn);
    const mic = button(/microphone/);
    mic.setAttribute("data-is-muted", "true");
    mic.setAttribute("aria-label", "Turn on microphone (⌘ + d)");
    // A burst of mutations that change nothing the adapter reads.
    for (let i = 0; i < 5; i++) document.body.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 10);
    expect(updates()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(updates()).toHaveLength(2);
    const last = updates().at(-1);
    expect(last?.kind === "update" && last.state.self.mic).toBe("off");

    document.body.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(updates()).toHaveLength(2);
  });

  it("sends a heartbeat every 5 s even without changes", async () => {
    start(FIXTURES.inCallEn);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(updates()).toHaveLength(4);
  });

  it("re-sends on request", () => {
    start(FIXTURES.inCallEn);
    session.resend();
    expect(updates()).toHaveLength(2);
  });

  it("reports the end of the call once", async () => {
    start(FIXTURES.inCallEn);
    document.body.innerHTML = "<main><p>You left the meeting</p></main>";
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(sent.filter((m) => m.kind === "ended")).toHaveLength(1);
    expect(sent.at(-1)).toEqual({ kind: "ended" });
  });
});
