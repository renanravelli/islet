# ADR 0002 — Bridge via Chrome Native Messaging and a local socket

- Status: Accepted
- Date: 2026-11-03

## Context

The Meet state lives in a Chrome tab. The island lives in a desktop app. We need a channel
between them that is local-only, works without accounts or servers, and does not keep processes
running when no meeting is open.

## Decision

### Topology

```
content script (meet.google.com) ⇄ service worker ⇄ native host (stdio) ⇄ local socket ⇄ app
```

- The service worker talks to `islet-native-host` with `chrome.runtime.connectNative`.
  Framing is Chrome's: 32-bit length in native byte order, then UTF-8 JSON.
- The native host relays messages to the app over a local socket (`interprocess`).
- Inside the app, `islet-provider-meet` receives and sends protocol messages over an in-process
  channel. The socket server lives in the shell (`src-tauri`), so the provider stays portable and
  testable without a socket.
- Every message carries `v: 1`. Messages larger than **64 KB** are rejected on both sides
  (Chrome's own limits are 1 MB host → extension and 64 MiB extension → host).

### Native host lifecycle

- The extension opens the `connectNative` port **only while at least one `meet.google.com` tab
  exists**, including the lobby, and closes it **30 s after the last such tab closes**.
  No service worker or host process stays resident just because Chrome is open.
- While the port is open, the host:
  - replies `error: app_not_running` when it cannot reach the app;
  - retries the socket connection with backoff;
  - opens the app in the background with `open -g` when a call starts. The `.app` path is derived
    from the host's own location (`Contents/MacOS/` → bundle), not from the bundle ID, so dev and
    release builds sharing an ID are not confused.
- Chrome 105+ keeps the service worker alive while a native port is open; the worker reconnects
  on `onDisconnect`.

### Socket security

- Path: `~/Library/Application Support/<bundle-id>/bridge.sock`, falling back to `$TMPDIR` when
  the path exceeds the Unix socket limit (103 bytes on macOS).
- The socket's directory is created with mode `0700`. The socket receives `chmod 0600` right after
  `bind` (`interprocess`'s pre-bind `mode()` does not work on macOS).
- The app verifies that the peer's effective UID equals its own and drops other connections.

### Host manifest and allowed origins

- The app installs the host manifest into Chrome's per-user `NativeMessagingHosts` directory
  during onboarding; `scripts/install-native-host.sh` does the same for development.
- `allowed_origins` contains the development extension ID (stable via the manifest `key`).
- **The Chrome Web Store ID is added only once it is real.** Until then it is a `TODO` constant in
  code and never written to the manifest: a made-up but well-formed ID could belong to another
  extension and grant it access to the host.
- Only Google Chrome is implemented. Paths for other Chromium browsers are documented only.

## Consequences

- No network access, no ports on localhost, no shared secrets to manage.
- The extension only works with the desktop app installed; the onboarding must make that clear.
- Bringing Chrome to the front from `focus_tab` relies on `chrome.windows.update` and must be
  validated manually on macOS.
