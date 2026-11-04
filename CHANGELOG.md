# Changelog

All notable changes to Islet. Versions follow [Semantic Versioning](https://semver.org); while
the version is below 1.0, every release is a beta.

## 0.1.2 — 2026-11-04

### Added

- **Participants' photos.** The island shows the photos Meet shows, instead of initials. The
  extension redraws the image Meet already loaded, small (72 pixels): nothing is downloaded, and
  it needs no new permission. A participant who turns the camera on keeps their photo for the
  rest of the call; without a photo, the island shows initials as before.
- **Others' raised hands.** When someone else raises a hand, the island shows the first in line,
  with their photo, and "+N" for the others; expanded, it names them and says how many hands are
  up. When the first in line changes, the island opens for 4 seconds to say so. The order is
  the one Meet shows; your own hand is left out. With **Mostrar nomes e fotos** off, it says
  "Someone raised their hand".
- **The setup guide detects the extension at once.** Right after it is installed or updated,
  the extension tests its connection with the app, so step 2 shows **Conectada** without a Meet
  tab. If the extension was already installed, **Abrir o Meet para testar** opens Meet to
  connect it.

### Changed

- The setting **Mostrar nomes dos participantes** is now **Mostrar nomes e fotos**: off, the
  island shows neither.
- The extension is on the Chrome Web Store, and the guides recommend it; loading it by hand
  still works.
- The setup guide's steps 2 to 4 follow the approved design more closely.

### Fixed

- **Configurações…** in the menu bar, and the setup guide, opened only on the second click.
- The setup guide said the extension was not connected when no Meet tab was open, although it
  was installed and working.
- The Chrome Web Store page and Meet opened in the default browser, which may not be Chrome.

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
