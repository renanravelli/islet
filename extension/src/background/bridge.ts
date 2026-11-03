// Routes messages between Meet tabs and the native host (docs/adr/0002).
//
// - The native port is open only while at least one meet.google.com tab is connected, and closes
//   30 s after the last one goes away. Nothing stays resident just because Chrome is open.
// - If the host goes away while tabs remain, it is reconnected with backoff.
// - `focus_tab` is handled here; other commands go to the tab, which confirms them.

import {
  type AppEnvelope,
  type CommandResult,
  type ExtensionMessage,
  type Hello,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from "@islet/protocol-ts";
import { warn } from "../shared/log";
import type { TabToWorker, WorkerToTab } from "../shared/messages";

export const CLOSE_AFTER_LAST_TAB_MS = 30_000;
export const FIRST_RETRY_MS = 1000;
export const MAX_RETRY_MS = 30_000;

/** The parts of a Chrome port the bridge uses, so tests can fake them. */
export interface PortLike<In, Out> {
  postMessage(message: Out): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: In) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export type NativePort = PortLike<unknown, unknown>;
export type TabPort = PortLike<TabToWorker, WorkerToTab>;

export interface BridgeDeps {
  connectNative(): NativePort;
  /** Activates the tab and focuses its window. */
  focusTab(tabId: number): Promise<boolean>;
  tabExists(tabId: number): Promise<boolean>;
  hello(): Hello;
}

const APP_TYPES = new Set(["command", "ping", "error"]);
const ACTIONS = new Set(["toggle_mic", "toggle_cam", "toggle_hand", "leave", "focus_tab"]);

interface Tab {
  port: TabPort;
  inCall: boolean;
}

export class Bridge {
  private readonly tabs = new Map<number, Tab>();
  private native: NativePort | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = FIRST_RETRY_MS;
  private appRunning = false;

  constructor(private readonly deps: BridgeDeps) {}

  /** Whether the app answered through the host since the port opened. */
  get connectedToApp(): boolean {
    return this.appRunning;
  }

  get nativeOpen(): boolean {
    return this.native !== undefined;
  }

  addTab(tabId: number, port: TabPort): void {
    this.tabs.set(tabId, { port, inCall: false });
    clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
    port.onMessage.addListener((message) => this.fromTab(tabId, message));
    port.onDisconnect.addListener(() => void this.removeTab(tabId, port));
    this.openNative();
  }

  private async removeTab(tabId: number, port: TabPort): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.port !== port) return;
    this.tabs.delete(tabId);
    if (tab.inCall) {
      const reason = (await this.deps.tabExists(tabId)) ? "navigated" : "tab_closed";
      this.send({ type: "session.ended", tab_id: tabId, reason });
    }
    if (this.tabs.size === 0) {
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => this.closeNative(), CLOSE_AFTER_LAST_TAB_MS);
    }
  }

  private fromTab(tabId: number, message: TabToWorker): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (message.kind === "update") {
      tab.inCall = true;
      this.send({ type: "session.update", tab_id: tabId, ...message.state });
    } else if (message.kind === "ended") {
      tab.inCall = false;
      this.send({ type: "session.ended", tab_id: tabId, reason: "call_ended" });
    } else {
      this.send({ type: "command.result", ...message.result });
    }
  }

  private openNative(): void {
    if (this.native || this.retryTimer) return;
    let port: NativePort;
    try {
      port = this.deps.connectNative();
    } catch {
      this.scheduleRetry();
      return;
    }
    this.native = port;
    port.onMessage.addListener((message) => this.fromHost(message));
    port.onDisconnect.addListener(() => {
      if (this.native !== port) return;
      this.native = undefined;
      this.appRunning = false;
      if (this.tabs.size > 0) this.scheduleRetry();
    });
    this.send({ type: "hello", ...this.deps.hello() });
  }

  private scheduleRetry(): void {
    warn("native host unavailable; retrying in ms", this.retryMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.tabs.size > 0) this.openNative();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }

  private closeNative(): void {
    this.closeTimer = undefined;
    if (this.tabs.size > 0) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const port = this.native;
    this.native = undefined;
    this.appRunning = false;
    port?.disconnect();
  }

  private fromHost(raw: unknown): void {
    // The host is alive: the next outage starts the backoff from the beginning.
    this.retryMs = FIRST_RETRY_MS;
    const message = parseAppMessage(raw);
    if (!message) return;
    switch (message.type) {
      case "ping":
        this.appRunning = true;
        this.send({ type: "pong" });
        for (const tab of this.tabs.values()) tab.port.postMessage({ kind: "resend" });
        break;
      case "error":
        if (message.code === "app_not_running") this.appRunning = false;
        else warn("native host reported", message.code);
        break;
      case "command":
        this.appRunning = true;
        void this.command(message.id, message.tab_id, message.action);
        break;
    }
  }

  private async command(id: number, tabId: number, action: string): Promise<void> {
    const reply = (result: CommandResult) => this.send({ type: "command.result", ...result });
    const tab = this.tabs.get(tabId);
    if (action === "focus_tab") {
      const ok = await this.deps.focusTab(tabId).catch(() => false);
      reply(ok ? { id, ok } : { id, ok, error: "tab_not_found" });
    } else if (!tab) {
      reply({ id, ok: false, error: "tab_not_found" });
    } else if (
      action === "toggle_mic" ||
      action === "toggle_cam" ||
      action === "toggle_hand" ||
      action === "leave"
    ) {
      tab.port.postMessage({ kind: "command", id, action });
    } else {
      reply({ id, ok: false, error: "unsupported" });
    }
  }

  /** Adds `v: 1`, enforces the size limit and posts to the host if the port is open. */
  private send(message: ExtensionMessage): void {
    if (!this.native) return;
    const envelope = { v: PROTOCOL_VERSION, ...message };
    const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
    if (bytes > MAX_MESSAGE_BYTES) {
      warn("dropped an oversized message of type", message.type);
      return;
    }
    this.native.postMessage(envelope);
  }
}

/**
 * Validates a message from the host. Unknown types, other versions and malformed messages are
 * logged without their content and ignored; they never close the port.
 */
export function parseAppMessage(raw: unknown): AppEnvelope | undefined {
  if (typeof raw !== "object" || raw === null) {
    warn("ignored a non-object message from the host");
    return undefined;
  }
  const message = raw as Record<string, unknown>;
  if (message.v !== PROTOCOL_VERSION) {
    warn("ignored a message with protocol version", String(message.v));
    return undefined;
  }
  const type = message.type;
  if (typeof type !== "string" || !APP_TYPES.has(type)) {
    warn("ignored a message of unknown type", typeof type === "string" ? safeType(type) : "<none>");
    return undefined;
  }
  if (type === "command") {
    const valid =
      Number.isInteger(message.id) &&
      Number.isInteger(message.tab_id) &&
      typeof message.action === "string" &&
      ACTIONS.has(message.action);
    if (!valid) {
      warn("ignored a malformed command");
      return undefined;
    }
  }
  if (type === "error" && typeof message.code !== "string") {
    warn("ignored a malformed error");
    return undefined;
  }
  return message as unknown as AppEnvelope;
}

function safeType(type: string): string {
  return /^[a-z0-9._]{1,32}$/.test(type) ? type : "<invalid>";
}
