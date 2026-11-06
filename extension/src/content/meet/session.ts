// Watches the page and reports the session to the worker: on change (throttled), as a
// heartbeat, when asked, and when the call ends.

import type { TabState, TabToWorker } from "../../shared/messages";
import type { MeetAdapter } from "./adapter";

/** The page is read at most this often while it keeps changing. */
export const READ_INTERVAL_MS = 150;
export const HEARTBEAT_MS = 5000;

export class MeetSession {
  private observer: MutationObserver | undefined;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private startedAt: number | undefined;
  private lastSent: string | undefined;
  private lastRead = Number.NEGATIVE_INFINITY;
  /** When the Leave button was first found missing. */
  private leftAt: number | undefined;

  constructor(
    private readonly adapter: MeetAdapter,
    private readonly root: Node,
    private readonly post: (message: TabToWorker) => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    this.heartbeat = setInterval(() => this.check(true), HEARTBEAT_MS);
    this.check(false);
  }

  stop(): void {
    this.observer?.disconnect();
    clearTimeout(this.pending);
    clearInterval(this.heartbeat);
  }

  /** The worker asked for the current state, for example after the app connected. */
  resend(): void {
    this.adapter.refresh();
    this.check(true);
  }

  /**
   * A change is read at once, then at most every READ_INTERVAL_MS while the page keeps changing,
   * with a last read once it settles. A debounce would wait for the page to go quiet, and while
   * someone talks Meet's level meter never does. A change past the interval is read at once even
   * with a read pending: hidden, Chrome stretches that timer to about a second (ADR 0005).
   */
  private schedule(): void {
    const wait = this.lastRead + READ_INTERVAL_MS - this.now();
    if (wait <= 0) {
      this.check(false);
    } else {
      this.later(wait);
    }
  }

  private later(wait: number): void {
    if (this.pending !== undefined) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.check(false);
    }, wait);
  }

  /** Sends the state if it changed, or always when `force` (heartbeat, resend). */
  private check(force: boolean): void {
    clearTimeout(this.pending);
    this.pending = undefined;
    this.lastRead = this.now();
    if (!this.adapter.detectInCall()) {
      if (this.startedAt === undefined) return;
      // Meet may drop the Leave button for a moment while it renders: the call has ended only
      // if the button is still missing a read interval later.
      this.leftAt ??= this.lastRead;
      if (this.lastRead - this.leftAt < READ_INTERVAL_MS) {
        this.later(READ_INTERVAL_MS);
        return;
      }
      this.startedAt = undefined;
      this.lastSent = undefined;
      this.leftAt = undefined;
      this.post({ kind: "ended" });
      return;
    }
    this.leftAt = undefined;
    this.startedAt ??= this.now();
    const state: TabState = { ...this.adapter.readState().state, started_at: this.startedAt };
    const json = JSON.stringify(state);
    if (force || json !== this.lastSent) {
      this.lastSent = json;
      this.post({ kind: "update", state });
    }
  }
}
