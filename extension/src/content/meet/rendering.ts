// Keeps Meet's page rendering while its tab is hidden (docs/adr/0005).
//
// Chrome pauses requestAnimationFrame in a hidden tab, and Meet updates its controls in
// animation frames: with Chrome behind another app, the page kept showing the state from before
// (measured 2026-11-03: the buttons' data-is-muted did not change while hidden). While the tab
// is hidden, frames run from a timer instead; Chrome throttles it to about once a second. This
// code only reschedules frames: it reads nothing and talks to nothing.

/** The delay of a frame run from a timer, as for a 60 Hz display. */
export const HIDDEN_FRAME_MS = 16;

type Target = Pick<
  Window & typeof globalThis,
  "requestAnimationFrame" | "cancelAnimationFrame" | "setTimeout" | "clearTimeout" | "performance"
>;

export function keepRendering(win: Target, doc: Pick<Document, "hidden">): void {
  const nativeRequest = win.requestAnimationFrame.bind(win);
  const nativeCancel = win.cancelAnimationFrame.bind(win);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  // Negative ids never collide with the browser's, which are positive.
  let nextId = -1;

  win.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    if (!doc.hidden) return nativeRequest(callback);
    const id = nextId--;
    timers.set(
      id,
      win.setTimeout(() => {
        timers.delete(id);
        callback(win.performance.now());
      }, HIDDEN_FRAME_MS),
    );
    return id;
  };

  win.cancelAnimationFrame = (id: number): void => {
    const timer = timers.get(id);
    if (timer === undefined) {
      nativeCancel(id);
      return;
    }
    win.clearTimeout(timer);
    timers.delete(id);
  };
}
