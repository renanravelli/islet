import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Bridge,
  CLOSE_AFTER_LAST_TAB_MS,
  FIRST_RETRY_MS,
  type NativePort,
  parseAppMessage,
  type TabPort,
} from "../src/background/bridge";
import type { TabState, TabToWorker, WorkerToTab } from "../src/shared/messages";
import { FakePort } from "./fakes";

const STATE: TabState = {
  meeting_code: "abc-defg-hij",
  started_at: 1_793_700_000_000,
  self: { mic: "on", cam: "off", hand: "off" },
  signals: {},
  capabilities: ["toggle_mic", "leave", "focus_tab"],
  health: "ok",
};

let natives: FakePort<unknown, unknown>[];
let existing: Set<number>;
let focused: number[];
let bridge: Bridge;

const native = () => {
  const port = natives.at(-1);
  if (!port) throw new Error("no native port");
  return port;
};

function tab(id: number): FakePort<TabToWorker, WorkerToTab> {
  const port = new FakePort<TabToWorker, WorkerToTab>();
  existing.add(id);
  bridge.addTab(id, port as TabPort);
  return port;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  natives = [];
  existing = new Set();
  focused = [];
  bridge = new Bridge({
    connectNative: () => {
      const port = new FakePort<unknown, unknown>();
      natives.push(port);
      return port as NativePort;
    },
    focusTab: async (id) => {
      focused.push(id);
      return existing.has(id);
    },
    tabExists: async (id) => existing.has(id),
    hello: () => ({ extension_version: "0.1.0", browser: "Chrome test" }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native port lifecycle", () => {
  it("stays closed until a Meet tab connects, then says hello", () => {
    expect(bridge.nativeOpen).toBe(false);
    tab(1);
    expect(natives).toHaveLength(1);
    expect(native().posted).toEqual([
      { v: 1, type: "hello", extension_version: "0.1.0", browser: "Chrome test" },
    ]);
    tab(2);
    expect(natives).toHaveLength(1);
  });

  it("closes 30 s after the last Meet tab goes away", async () => {
    const one = tab(1);
    const two = tab(2);
    one.drop();
    two.drop();
    await vi.advanceTimersByTimeAsync(CLOSE_AFTER_LAST_TAB_MS - 1);
    expect(native().disconnected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(native().disconnected).toBe(true);
    expect(bridge.nativeOpen).toBe(false);
  });

  it("keeps the port when a tab returns within 30 s", async () => {
    tab(1).drop();
    await vi.advanceTimersByTimeAsync(10_000);
    tab(1);
    await vi.advanceTimersByTimeAsync(CLOSE_AFTER_LAST_TAB_MS);
    expect(native().disconnected).toBe(false);
    expect(natives).toHaveLength(1);
  });

  it("reconnects with backoff while tabs remain, and stops when they leave", async () => {
    const one = tab(1);
    native().drop();
    expect(bridge.nativeOpen).toBe(false);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS);
    expect(natives).toHaveLength(2);
    native().drop();
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS);
    expect(natives).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS);
    expect(natives).toHaveLength(3);

    one.drop();
    native().drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(natives).toHaveLength(3);
  });

  it("keeps the port open when the app is not running", () => {
    tab(1);
    native().deliver({ v: 1, type: "error", code: "app_not_running" });
    expect(native().disconnected).toBe(false);
    expect(bridge.connectedToApp).toBe(false);
  });
});

describe("routing", () => {
  it("forwards tab state with the tab id and the version", () => {
    const port = tab(7);
    port.deliver({ kind: "update", state: STATE });
    expect(native().posted.at(-1)).toEqual({ v: 1, type: "session.update", tab_id: 7, ...STATE });
    port.deliver({ kind: "ended" });
    expect(native().posted.at(-1)).toEqual({
      v: 1,
      type: "session.ended",
      tab_id: 7,
      reason: "call_ended",
    });
  });

  it("ends a session when its tab closes or navigates away", async () => {
    const closing = tab(1);
    closing.deliver({ kind: "update", state: STATE });
    existing.delete(1);
    closing.drop();
    await vi.waitFor(() =>
      expect(native().posted.at(-1)).toMatchObject({
        type: "session.ended",
        tab_id: 1,
        reason: "tab_closed",
      }),
    );

    const navigating = tab(2);
    navigating.deliver({ kind: "update", state: STATE });
    navigating.drop();
    await vi.waitFor(() =>
      expect(native().posted.at(-1)).toMatchObject({
        type: "session.ended",
        tab_id: 2,
        reason: "navigated",
      }),
    );

    // A tab that never was in a call ends nothing.
    const count = native().posted.length;
    tab(3).drop();
    await vi.advanceTimersByTimeAsync(10);
    expect(native().posted).toHaveLength(count);
  });

  it("answers ping with pong and asks every tab to re-send", () => {
    const one = tab(1);
    const two = tab(2);
    native().deliver({ v: 1, type: "ping" });
    expect(native().posted.at(-1)).toEqual({ v: 1, type: "pong" });
    expect(one.posted).toEqual([{ kind: "resend" }]);
    expect(two.posted).toEqual([{ kind: "resend" }]);
    expect(bridge.connectedToApp).toBe(true);
  });

  it("sends commands to their tab and relays the result", () => {
    const port = tab(4);
    native().deliver({ v: 1, type: "command", id: 9, tab_id: 4, action: "toggle_mic" });
    expect(port.posted).toEqual([{ kind: "command", id: 9, action: "toggle_mic" }]);
    port.deliver({ kind: "result", result: { id: 9, ok: true } });
    expect(native().posted.at(-1)).toEqual({ v: 1, type: "command.result", id: 9, ok: true });
  });

  it("answers commands for unknown tabs itself", async () => {
    tab(1);
    native().deliver({ v: 1, type: "command", id: 3, tab_id: 99, action: "leave" });
    await vi.waitFor(() =>
      expect(native().posted.at(-1)).toEqual({
        v: 1,
        type: "command.result",
        id: 3,
        ok: false,
        error: "tab_not_found",
      }),
    );
  });

  it("focuses the tab itself", async () => {
    const port = tab(5);
    native().deliver({ v: 1, type: "command", id: 1, tab_id: 5, action: "focus_tab" });
    await vi.waitFor(() =>
      expect(native().posted.at(-1)).toEqual({ v: 1, type: "command.result", id: 1, ok: true }),
    );
    expect(focused).toEqual([5]);
    expect(port.posted).toEqual([]);
  });

  it("drops messages over 64 KB", () => {
    const port = tab(1);
    const before = native().posted.length;
    port.deliver({ kind: "update", state: { ...STATE, title: "x".repeat(70_000) } });
    expect(native().posted).toHaveLength(before);
  });
});

describe("parseAppMessage", () => {
  it("ignores, without throwing, what this version does not understand", () => {
    for (const bad of [
      null,
      "ping",
      { type: "ping" },
      { v: 2, type: "ping" },
      { v: 1, type: "teleport" },
      { v: 1, type: "command", id: "1", tab_id: 1, action: "toggle_mic" },
      { v: 1, type: "command", id: 1, tab_id: 1, action: "open_chat" },
      { v: 1, type: "error" },
    ]) {
      expect(parseAppMessage(bad)).toBeUndefined();
    }
    expect(console.warn).toHaveBeenCalled();
  });

  it("never logs message content", () => {
    parseAppMessage({ v: 1, type: "Alex Example joined" });
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).not.toContain("Alex");
  });

  it("keeps the port open after an unknown message", () => {
    const port = tab(1);
    native().deliver({ v: 1, type: "teleport" });
    native().deliver({ v: 1, type: "ping" });
    expect(native().disconnected).toBe(false);
    expect(port.posted).toEqual([{ kind: "resend" }]);
  });
});
