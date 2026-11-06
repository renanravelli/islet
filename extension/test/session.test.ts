import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetAdapter } from "../src/content/meet/adapter";
import { HEARTBEAT_MS, MeetSession, READ_INTERVAL_MS } from "../src/content/meet/session";
import type { TabToWorker } from "../src/shared/messages";
import { button, FIXTURES, load } from "./dom";

const START = 1_793_700_000_000;

let sent: TabToWorker[];
let session: MeetSession;

function start(html: string): void {
  load(html);
  sent = [];
  session = new MeetSession(new MeetAdapter(document), document, (m) => sent.push(m));
  session.start();
}

const updates = () => sent.filter((m) => m.kind === "update");
const lastMic = () => {
  const last = updates().at(-1);
  return last?.kind === "update" ? last.state.self.mic : undefined;
};

beforeEach(() => vi.useFakeTimers({ now: START }));
afterEach(() => {
  session.stop();
  vi.useRealTimers();
});

describe("MeetSession", () => {
  it("reports a call at once, with when it started", () => {
    start(FIXTURES.inCallEn);
    expect(sent).toHaveLength(1);
    const [first] = updates();
    expect(first?.kind === "update" && first.state.started_at).toBe(START);
  });

  it("says nothing in the lobby", async () => {
    start(FIXTURES.lobby);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    expect(sent).toEqual([]);
  });

  it("sends a change at once once the page has been quiet", async () => {
    start(FIXTURES.inCallEn);
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS);
    button(/microphone/).setAttribute("data-is-muted", "true");
    await vi.advanceTimersByTimeAsync(0);
    expect(updates()).toHaveLength(2);
    expect(lastMic()).toBe("off");
  });

  it("reads at most once per interval, and once more after the page settles", async () => {
    start(FIXTURES.inCallEn);
    const mic = button(/microphone/);
    // Right after a read: the change waits for the interval, however many mutations follow.
    mic.setAttribute("data-is-muted", "true");
    for (let i = 0; i < 5; i++) document.body.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS - 10);
    expect(updates()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(updates()).toHaveLength(2);
    expect(lastMic()).toBe("off");

    // Mutations that change nothing the adapter reads send nothing.
    document.body.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS * 2);
    expect(updates()).toHaveLength(2);
  });

  it("does not wait for the page to go quiet: a level meter that never stops", async () => {
    start(FIXTURES.inCallEn);
    const meter = document.createElement("div");
    document.body.append(meter);
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS);
    button(/microphone/).setAttribute("data-is-muted", "true");
    for (let i = 0; i < 60; i++) {
      meter.className = `level-${i % 3}`;
      await vi.advanceTimersByTimeAsync(50);
      if (lastMic() === "off") break;
    }
    expect(lastMic()).toBe("off");
    // A debounce sent it only after the meter stopped (3 s here) or with the heartbeat.
    expect(Date.now() - START).toBeLessThanOrEqual(READ_INTERVAL_MS * 2);
  });

  it("reads a change at once even while a stretched timer is still pending", async () => {
    start(FIXTURES.inCallEn);
    // A read is scheduled, as when mutations arrive right after a read...
    document.body.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(1);
    // ...and Chrome, with the tab hidden, has not run it when the next render arrives a second
    // later. (setSystemTime moves the clock without running timers.)
    vi.setSystemTime(START + 1000);
    button(/microphone/).setAttribute("data-is-muted", "true");
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMic()).toBe("off");
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
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS * 2);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(sent.filter((m) => m.kind === "ended")).toHaveLength(1);
    expect(sent.at(-1)).toEqual({ kind: "ended" });
  });

  it("does not end the call when Leave disappears for a moment while Meet renders", async () => {
    start(FIXTURES.inCallEn);
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS);
    const leave = document.querySelector("[jsname='CQylAd']");
    const parent = leave?.parentElement;
    if (!leave || !parent) throw new Error("the fixture has no Leave button");
    leave.remove();
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS / 3);
    parent.append(leave);
    await vi.advanceTimersByTimeAsync(READ_INTERVAL_MS * 2);
    expect(sent.filter((m) => m.kind === "ended")).toEqual([]);
  });
});
