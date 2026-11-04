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
- The native host relays messages to the app over a local socket, framed the same way.
- The transport (framing, socket server and client, socket path, host manifest) lives in
  `islet-bridge`, used by both the host and the app shell. It is a crate, not code inside
  `src-tauri`, so the host ↔ server path is tested without Tauri. On Unix it uses tokio's own
  Unix sockets: they give the peer's credentials safely, so no extra dependency (`interprocess`
  was planned) and no `unsafe` are needed. Windows (named pipes) is a stub until it is in scope.
- Inside the app, `islet-provider-meet` receives and sends protocol messages over an in-process
  channel, so the provider stays portable and testable without a socket.
- Every message carries `v: 1`. Messages larger than **64 KB** are rejected on both sides
  (Chrome's own limits are 1 MB host → extension and 64 MiB extension → host).
- The extension's heartbeat is the unchanged `session.update`, re-sent every 5 s. The native host
  reports its own failures to the extension as `error { code }` (for example `app_not_running`).
- The app sends `ping` when a host connects; the extension answers `pong` and re-sends the state
  of every meeting tab at once instead of waiting for the next heartbeat.
- A message the app cannot use (unknown `type`, other version, malformed, oversized) is logged
  without its content and skipped. It never closes the connection.
- Within `v: 1` the protocol only grows optional fields; peers ignore fields they do not know.
  Anything else needs a new version, and a peer rejects versions it does not speak.

### Native host lifecycle

- The extension opens the `connectNative` port **only while at least one `meet.google.com` tab
  exists**, including the lobby, and closes it **30 s after the last such tab closes**.
  No service worker or host process stays resident just because Chrome is open.
- **Connection test (added 2026-11-04):** when the extension is installed or updated
  (`runtime.onInstalled`), it opens the port without a Meet tab, says `hello` and closes it
  10 s later unless a Meet tab connects meanwhile. Without it, onboarding step 2 could not tell
  an installed extension from a missing one until the person opened Meet, and showed "not
  connected" to people who had done everything right. It runs once per install or update, so
  nothing stays resident.
- The host starts only for an allowed origin: Chrome passes the caller's origin as the first
  argument, and the host checks it against `crates/bridge/extension-ids.txt` (exit code 2
  otherwise), on top of Chrome's own `allowed_origins` check.
- While the port is open, the host:
  - forwards frames as they are; it only peeks at `hello`, which it replays to the app on every
    connection, and at session messages, to know when a call starts;
  - sends Chrome one `error: app_not_running` each time the app becomes unreachable (not one
    per message) and drops messages meanwhile;
  - retries the socket with backoff: 250 ms, doubling up to 5 s, reset after a connection;
  - opens the app in the background with `open -g` when a call starts in a tab it has not seen
    yet, at most once every 30 s. A user who quits the app mid-call is not overridden. The `.app`
    path is derived from the host's own location (`Contents/MacOS/` → bundle), not from the
    bundle ID, so dev and release builds sharing an ID are not confused. Outside a bundle
    (development) the host never opens the app;
  - exits with code 0 when Chrome closes stdin.
- **stdout carries Chrome's framing and nothing else.** Logs go to stderr and, because Chrome
  usually discards a host's stderr, to `~/Library/Logs/<bundle-id>/native-host.<date>.log`
  (daily rotation, at most 7 files; `ISLET_LOG` sets the level, default `info`). The app logs to
  the same folder. `clippy::print_stdout` is denied in the host crate, children (`open`) get a null
  stdout, and an integration test checks that stdout parses as frames to the last byte.
- Every frame's 4-byte length is checked before the body is read or allocated. An oversized body
  is skipped through a small buffer, so the stream stays in sync; Chrome gets
  `error: message_too_large`.
- Chrome 105+ keeps the service worker alive while a native port is open; the worker reconnects
  on `onDisconnect`.

### Socket security

- Path: `~/Library/Application Support/<bundle-id>/bridge.sock`, falling back to `$TMPDIR` when
  the path exceeds the Unix socket limit (103 bytes on macOS).
- The socket's directory is created with mode `0700` (an existing one owned by us is tightened to
  `0700`; one owned by someone else is refused). The socket receives `chmod 0600` right after
  `bind`. A socket left by a crashed app is replaced; a live one means another instance runs.
- Both sides check that the peer's effective UID equals their own (`peer_cred`); the app drops
  other connections. The own UID is read from a socket pair, which avoids `unsafe` `getuid`.
- `ISLET_BRIDGE_SOCKET` overrides the path, for tests and development.

### Host manifest and allowed origins

- The app checks the host manifest in Chrome's per-user `NativeMessagingHosts` directory on every
  start and rewrites it when it is missing, unreadable or points elsewhere (for example after the
  app was moved to `/Applications`). The same routine backs "Reinstall Chrome bridge", and
  `scripts/install-native-host.sh` runs it for development. It does not create Chrome's profile
  directory when Chrome is not installed.
- `allowed_origins` contains the development extension ID, fixed by the public key committed as
  the extension manifest's `key`; the private key is never committed.
- **The Chrome Web Store ID is added only once it is real.** Until then it is a `TODO` comment in
  `extension-ids.txt` and never written to the manifest: a made-up but well-formed ID could belong to another
  extension and grant it access to the host.
- Only Google Chrome is implemented. Paths for other Chromium browsers are documented only.

## Consequences

- No network access, no ports on localhost, no shared secrets to manage.
- The extension only works with the desktop app installed; the onboarding must make that clear.
- Bringing Chrome to the front from `focus_tab` relies on `chrome.windows.update` and must be
  validated manually on macOS.
