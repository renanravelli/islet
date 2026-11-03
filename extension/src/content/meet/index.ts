// Content script for meet.google.com. Built as a standalone IIFE (no loader, no
// web_accessible_resources), so the page cannot detect the extension through its files.

import { continueCalibration, runCalibration } from "../../debug/calibration";
import { captureSnapshot, type SnapshotOptions } from "../../debug/snapshot";
import { STEPS } from "../../debug/steps";
import type { TabAction, TabToWorker, WorkerToTab } from "../../shared/messages";
import { TAB_PORT } from "../../shared/messages";
import { MeetAdapter } from "./adapter";
import { resolve, SELECTORS, type SelectorKey } from "./selectors";
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

// For calibration (docs/meet-adapter/calibration-session.md), development builds only: reachable
// from this extension's isolated world in DevTools (the "Islet" console context), never from the
// Meet page. Release builds drop this block and the debug modules it imports;
// scripts/check-release-build.mjs verifies it.
if (__ISLET_DEBUG__) {
  const askNames = () =>
    window.prompt(
      "Islet snapshot: names to redact, comma separated (yours and every participant's).",
      "",
    );
  Object.assign(globalThis, {
    isletDebug: {
      selectorsVersion: SELECTORS.version,
      inCall: () => adapter.detectInCall(),
      readState: () => adapter.readState(),
      /** The element a key resolves to, or null; DevTools highlights it on hover. */
      find: (key: SelectorKey) => resolve(document, SELECTORS.keys[key].strategies),
      execute: (action: TabAction) => adapter.execute(action),
      /** One anonymized snapshot. Without options it asks for the names and before saving. */
      captureSnapshot(options?: Partial<SnapshotOptions>) {
        const names = options?.names ?? askNames()?.split(",");
        if (names === undefined) return null;
        return captureSnapshot({ auto: false, ...options, names });
      },
      runCalibration: (entry?: string) => runCalibration(entry, { adapter }),
      continue: () => continueCalibration(),
      steps: STEPS.map((step) => step.id),
    },
  });
}
