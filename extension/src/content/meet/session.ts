// Watches the page and reports the session to the worker: on change (debounced), as a
// heartbeat, when asked, and when the call ends.

import type { TabState, TabToWorker } from "../../shared/messages";
import type { MeetAdapter } from "./adapter";

export const DEBOUNCE_MS = 150;
export const HEARTBEAT_MS = 5000;

export class MeetSession {
  private observer: MutationObserver | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private startedAt: number | undefined;
  private lastSent: string | undefined;

  constructor(
    private readonly adapter: MeetAdapter,
    private readonly root: Node,
    private readonly post: (message: TabToWorker) => void,
    private readonly now: () => number = Date.now,
    private readonly hidden: () => boolean = () => document.hidden,
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
    clearTimeout(this.debounce);
    clearInterval(this.heartbeat);
  }

  /** The worker asked for the current state, for example after the app connected. */
  resend(): void {
    this.check(true);
  }

  private schedule(): void {
    // Hidden, Meet renders about once a second (ADR 0005) and each render arrives as one batch
    // of mutations; a debounce timer, which Chrome also throttles to a second, would only add
    // that much delay.
    if (this.hidden()) {
      this.check(false);
      return;
    }
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.check(false), DEBOUNCE_MS);
  }

  /** Sends the state if it changed, or always when `force` (heartbeat, resend). */
  private check(force: boolean): void {
    if (!this.adapter.detectInCall()) {
      if (this.startedAt !== undefined) {
        this.startedAt = undefined;
        this.lastSent = undefined;
        this.post({ kind: "ended" });
      }
      return;
    }
    this.startedAt ??= this.now();
    const state: TabState = { ...this.adapter.readState().state, started_at: this.startedAt };
    const json = JSON.stringify(state);
    if (force || json !== this.lastSent) {
      this.lastSent = json;
      this.post({ kind: "update", state });
    }
  }
}
