import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HIDDEN_FRAME_MS, keepRendering } from "../src/content/meet/rendering";

function setup() {
  const native = { request: vi.fn(() => 7), cancel: vi.fn() };
  const win = {
    requestAnimationFrame: native.request as (cb: FrameRequestCallback) => number,
    cancelAnimationFrame: native.cancel as (id: number) => void,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    performance: { now: () => 123 } as Performance,
  };
  const doc = { hidden: false };
  keepRendering(win as unknown as Parameters<typeof keepRendering>[0], doc);
  return { win, doc, native };
}

describe("keepRendering", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("leaves visible frames to the browser", () => {
    const { win, native } = setup();
    const callback = vi.fn();
    expect(win.requestAnimationFrame(callback)).toBe(7);
    expect(native.request).toHaveBeenCalledWith(callback);
    win.cancelAnimationFrame(7);
    expect(native.cancel).toHaveBeenCalledWith(7);
  });

  it("runs frames from a timer while the tab is hidden", () => {
    const { win, doc, native } = setup();
    doc.hidden = true;
    const callback = vi.fn();
    const id = win.requestAnimationFrame(callback);
    expect(id).toBeLessThan(0);
    expect(native.request).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HIDDEN_FRAME_MS);
    expect(callback).toHaveBeenCalledWith(123);
  });

  it("cancels a timer frame without touching the browser's", () => {
    const { win, doc, native } = setup();
    doc.hidden = true;
    const callback = vi.fn();
    win.cancelAnimationFrame(win.requestAnimationFrame(callback));
    vi.advanceTimersByTime(HIDDEN_FRAME_MS * 2);
    expect(callback).not.toHaveBeenCalled();
    expect(native.cancel).not.toHaveBeenCalled();
  });
});
