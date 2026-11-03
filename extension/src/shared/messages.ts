// Messages between a Meet tab's content script and the service worker. They never leave the
// extension; the worker turns them into bridge protocol messages.

import type { Action, CommandResult, SessionUpdate } from "@islet/protocol-ts";

/** The name of the runtime port each Meet tab opens to the worker. */
export const TAB_PORT = "islet-meet-tab";

/** A tab's session state. The worker adds `tab_id`, which the tab does not know. */
export type TabState = Omit<SessionUpdate, "tab_id">;

/** Actions the content script performs itself; `focus_tab` is the worker's job. */
export type TabAction = Exclude<Action, "focus_tab">;

export type TabToWorker =
  | { kind: "update"; state: TabState }
  | { kind: "ended" }
  | { kind: "result"; result: CommandResult };

export type WorkerToTab = { kind: "command"; id: number; action: TabAction } | { kind: "resend" };
