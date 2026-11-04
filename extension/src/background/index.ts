// Service worker entry: wires the Bridge to Chrome's APIs.
//
// Chrome 105+ keeps the worker alive while the native port is open, and the port is open only
// while a Meet tab is connected (or for the 10 s connection test after an install or update),
// so the worker sleeps when there is no meeting tab.

import { HOST_NAME } from "../shared/host";
import { TAB_PORT } from "../shared/messages";
import { Bridge, type TabPort } from "./bridge";

const bridge = new Bridge({
  connectNative: () => chrome.runtime.connectNative(HOST_NAME),
  async focusTab(tabId) {
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return true;
    } catch {
      return false;
    }
  },
  async tabExists(tabId) {
    try {
      await chrome.tabs.get(tabId);
      return true;
    } catch {
      return false;
    }
  },
  hello: () => ({
    extension_version: chrome.runtime.getManifest().version,
    browser: browserName(),
  }),
});

// The app's onboarding waits for this hello right after "Add to Chrome" (ADR 0002).
chrome.runtime.onInstalled.addListener(() => bridge.testConnection());

chrome.runtime.onConnect.addListener((port) => {
  const tabId = port.sender?.tab?.id;
  if (port.name !== TAB_PORT || tabId === undefined) return;
  bridge.addTab(tabId, port as unknown as TabPort);
});

function browserName(): string {
  const brands = (
    navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }
  ).userAgentData?.brands;
  const brand =
    brands?.find((b) => b.brand === "Google Chrome") ??
    brands?.find((b) => !/not.?a.?brand/i.test(b.brand));
  return brand ? `${brand.brand} ${brand.version}` : "unknown";
}
