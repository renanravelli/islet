# ADR 0003 — `Unknown` state policy

- Status: Accepted
- Date: 2026-11-03

## Context

Islet reads meeting state from a third-party UI that changes without notice. Showing a muted
microphone as live, or a live one as muted, is worse than showing nothing.

## Decision

1. Every media state is a tri-state `Toggle { On, Off, Unknown }`. There is no boolean shortcut.
2. `Unknown` has its own neutral visual and is **never** rendered as "on".
3. **No optimistic UI.** A command (e.g. toggle mic) does not change the displayed state; only a
   state update confirmed by the provider does. A command that is not confirmed in time returns a
   typed error (provider confirmation 1.5 s, core command timeout 2 s).
4. When a provider cannot read part of the state, the session is marked `health: degraded` with
   explicit reasons. Next to the provider-agnostic reasons, the core keeps `provider_details`:
   opaque identifiers defined by the provider (for Meet, the failing `selectors.json` keys). The
   core never interprets them and the UI only displays them. They never contain names, titles
   or page text; the core also refuses anything that is not a short identifier. A session without a heartbeat for 10 s becomes `degraded` with reason
   `stale`. The island shows a discreet indicator with a tooltip instead of wrong data.
5. **What we can no longer vouch for is not shown.** A stale session shows mic, camera and hand
   as `Unknown` and drops the active speaker and signals until the next update. An ended session
   offers no controls. Both rules live in the core, so every shell gets them.
6. The primary session is the one with the mic or camera `On`; then the most recently _changed_
   active one; then the most recently ended one. Unchanged heartbeats do not count as changes, so
   two open calls do not swap places every few seconds, and `Unknown` never counts as `On`.

## Consequences

- Providers must report what they could not read instead of guessing.
- The UI needs icons and labels for `Unknown` and `degraded` in every state.
