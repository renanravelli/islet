# ADR 0005 — Keep Meet rendering while its tab is hidden

- Status: Accepted
- Date: 2026-11-03

## Context

The extension reads the call's state from Meet's DOM (ADR 0004). The island matters most when
Chrome is behind another app, which is exactly when macOS reports the tab as hidden.

Measured in a real call (2026-11-03, a one-second log of the controls' attributes):

- with the tab visible, every change reached the island within a second;
- with the tab hidden, `data-is-muted` and the hand button's label did not change at all, even
  though the commands took effect in the call. The page only caught up once Chrome was in front.

Chrome pauses `requestAnimationFrame` in hidden tabs, and Meet updates its controls in animation
frames. Replacing `requestAnimationFrame` from the DevTools console, after the page had loaded,
changed nothing (Meet keeps its own reference). Replacing it before the page loads fixed it: the
island followed every change with Chrome in the background.

## Decision

1. A second content script, `src/content/meet/keep-rendering.ts`, runs in Meet's own world
   (`"world": "MAIN"`) at `document_start`. While `document.hidden`, it runs animation-frame
   callbacks from a timer (16 ms, which Chrome throttles to about once a second); while visible,
   it leaves frames to the browser.
2. It only reschedules frames. It reads nothing from the page, uses no extension API and sends no
   messages. The adapter stays in the isolated world.
3. `scripts/check-release-build.mjs` fails a release build whose page-world script uses
   extension APIs, messaging or DOM reads, or that has more than one page-world script. A test
   pins the manifest entry.

## Consequences

- The island stays in sync while Chrome is in the background, with up to about a second of delay.
  While hidden, the content script reads the page as soon as a render's mutations arrive: a
  read is never left waiting on a timer, which Chrome would stretch to a second.
- Meet keeps running its frame callbacks while hidden, at about once a second: a little more CPU
  than Chrome's default.
- The page can tell that `requestAnimationFrame` was replaced. If Meet stops using animation
  frames for its controls, the island falls back to showing stale state while hidden; the
  calibration session should keep checking it with Chrome in the background.
- Not verified: behavior after a long time hidden, when Chrome may throttle timers further.
