// A fake Chrome port: records what is posted and lets tests deliver messages and disconnects.

import type { PortLike } from "../src/background/bridge";

export class FakePort<In, Out> implements PortLike<In, Out> {
  readonly posted: Out[] = [];
  disconnected = false;
  private readonly messageListeners: ((message: In) => void)[] = [];
  private readonly disconnectListeners: (() => void)[] = [];

  onMessage = { addListener: (l: (message: In) => void) => void this.messageListeners.push(l) };
  onDisconnect = { addListener: (l: () => void) => void this.disconnectListeners.push(l) };

  postMessage(message: Out): void {
    this.posted.push(message);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** The other side sends `message`. */
  deliver(message: In): void {
    for (const l of this.messageListeners) l(message);
  }

  /** The other side goes away. */
  drop(): void {
    for (const l of this.disconnectListeners) l();
  }
}
