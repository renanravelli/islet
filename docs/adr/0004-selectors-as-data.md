# ADR 0004 — Meet selectors as data

- Status: Accepted
- Date: 2026-11-03

## Context

The Meet adapter depends on Google Meet's DOM, which changes often and is localized. Manifest V3
forbids remotely hosted code but allows remote data.

## Decision

1. Every DOM dependency lives in a declarative registry,
   `extension/src/content/meet/selectors.json`, with `version` and `updated` fields.
2. Keys are semantic (`leaveButton`, `micButton`, `camButton`, `handButton`, `activeSpeaker`,
   `participantCount`, `mutedSpeakingNotice`, `meetingTitle`). Each key has an ordered list of
   strategies: CSS selector, `aria-label` regex per locale (pt-BR and en), attribute.
3. Each entry carries `"verified": true|false`. Entries not checked against a real call stay
   `false`; v0.1 starts with synthetic fixtures only.
4. Every read records which keys failed and fills `degraded_reasons` (see ADR 0003).
5. The adapter never reads the chat, never captures audio or video and makes no network requests.

## Consequences

- Fixing a Meet UI change is usually a JSON edit plus a fixture, reviewable by non-experts.
- A future remote selector update can ship as JSON without violating MV3.
- Calibration against a real call is a manual step (`docs/meet-adapter/calibration.md`).
