// Test helpers: load a synthetic fixture into jsdom's document.

import degraded from "./fixtures/meet-degraded.en.html?raw";
import inCallEn from "./fixtures/meet-in-call.en.html?raw";
import inCallPtBr from "./fixtures/meet-in-call.pt-BR.html?raw";
import lobby from "./fixtures/meet-lobby.en.html?raw";

export const FIXTURES = { inCallEn, inCallPtBr, lobby, degraded };

export function load(html: string, path = "/abc-defg-hij"): void {
  window.history.replaceState(null, "", path);
  document.body.innerHTML = html;
}

export function button(label: RegExp): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.getAttribute("aria-label") ?? ""),
  );
  if (!found) throw new Error(`no button matching ${label}`);
  return found;
}
