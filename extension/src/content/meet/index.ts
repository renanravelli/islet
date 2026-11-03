// Content script for meet.google.com. Built as a standalone IIFE (no loader, no
// web_accessible_resources), so the page cannot detect the extension through its files.

import type { TabAction, TabToWorker, WorkerToTab } from "../../shared/messages";
import { TAB_PORT } from "../../shared/messages";
import { MeetAdapter } from "./adapter";
import { SELECTORS } from "./selectors";
import { MeetSession } from "./session";

const RECONNECT_MS = 1000;

const adapter = new MeetAdapter(document);
let port: chrome.runtime.Port | undefined;

function post(message: TabToWorker): void {
  port?.postMessage(message);
}

const session = new MeetSession(adapter, document, post);

function connect(): void {
  // The extension was reloaded or removed: this script is orphaned; stop.
  if (!chrome.runtime?.id) {
    session.stop();
    return;
  }
  port = chrome.runtime.connect({ name: TAB_PORT });
  port.onMessage.addListener((message: WorkerToTab) => {
    if (message.kind === "resend") {
      session.resend();
    } else if (message.kind === "command") {
      void adapter.execute(message.action).then((error) => {
        post({
          kind: "result",
          result:
            error === null ? { id: message.id, ok: true } : { id: message.id, ok: false, error },
        });
      });
    }
  });
  port.onDisconnect.addListener(() => {
    // The worker restarted; reconnect and send the state again.
    port = undefined;
    setTimeout(() => {
      connect();
      session.resend();
    }, RECONNECT_MS);
  });
}

connect();
session.start();

// For calibration (docs/meet-adapter/calibration.md): reachable only from this extension's
// isolated world in DevTools (the "Islet" console context), never from the Meet page.
Object.assign(globalThis, {
  isletDebug: {
    selectorsVersion: SELECTORS.version,
    readState: () => adapter.readState(),
    execute: (action: TabAction) => adapter.execute(action),
  },
});
