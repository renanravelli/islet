# Changelog

All notable changes to Islet. Versions follow [Semantic Versioning](https://semver.org); while
the version is below 1.0, every release is a beta.

## 0.1.1 — 2026-11-04

### Added

- **In-app updates.** Turn on **Check for updates automatically** in the setup guide or in
  Settings → Privacy & About, or click **Check now**. When a new version exists, Settings and the
  menu bar offer **Install and restart**; Islet never installs or restarts by itself. Updates are
  signed and checked before they install. This is the app's only network connection, and it is
  off until you turn it on.
- The app accepts the extension from the Chrome Web Store, and the setup guide's **Install
  extension** opens its store page. The listing is under review; until it is live, load the
  extension from the release zip.
- A [privacy policy](PRIVACY.md).

### Changed

- Released builds show only what works: demo mode and the list of planned integrations are gone
  (demo mode stays in development builds).
- The privacy statement now names the update check as the one exception to "no network
  connections".

### Fixed

- The extension guide no longer suggests building the release zip, which is ready to load.

## 0.1.0-beta.1 — 2026-11-03

The first public beta: Google Meet in Chrome, shown in an island around the MacBook notch.

- The compact island: who is speaking, your mic, a raised hand, a camera icon while you are on
  video, and the call's duration.
- The expanded island: the meeting title, the speaker, up to three participants and the head
  count, and controls to mute, turn the camera on or off, raise your hand, open the Meet tab or
  leave. Leave never ends the call for everyone.
- `⌃⌥I` expands and collapses the island; `⌃⌥M` mutes and unmutes from any app.
- A floating pill on screens without a notch.
- Experimental: active speaker detection, and an alert when you talk while muted (off by default).
- English and Portuguese, light and dark windows, launch at login.
