# ADR 0006 — In-app updates, the app's only network access

- Status: Accepted
- Date: 2026-11-04

## Context

Islet is local-first: until now the app and the extension made no network connections at all
(CLAUDE.md, principle 4). The extension updates itself once it comes from the Chrome Web Store,
but the app does not: people had to notice a new release on GitHub, download the DMG and
replace the app by hand, and most never would.

The owner chose an in-app updater over a "check for updates" link (no network, but no way to
know a version exists) and a Homebrew tap (network through brew, but only for Homebrew users),
on 2026-11-03, as an explicit exception to principle 4.

## Decision

1. **One exception.** The updater is the only code in the app that uses the network. The
   extension still makes none. There are no accounts, no analytics and nothing about the
   person, the Mac or the calls in any request.
2. **The person decides when it checks.** `check_for_updates` is off until they turn it on, in
   onboarding step 4 or in Settings. When on, the app checks 10 s after it starts and then once
   a day. "Check now" always works, setting or not.
3. **The person decides when it installs.** A new version shows in Settings and in the menu bar
   ("Install and restart"); the app never installs or restarts by itself, so it never interrupts
   the island during a call.
4. **Only this repository.** `tauri-plugin-updater` (Tauri's official updater) reads
   `https://raw.githubusercontent.com/renanravelli/islet/updater/latest.json` and downloads the
   bundle that file names from the repository's GitHub releases. A test pins the endpoint.
5. **Signed updates.** Every update bundle is signed at release time with the updater's private
   key (the `TAURI_SIGNING_PRIVATE_KEY` secret, kept outside the repository); the app installs it
   only if the signature matches the public key in `tauri.conf.json`. This is separate from
   Apple's code signing.
6. **Publishing offers the update.** `release.yml` attaches `Islet_<version>_universal.app.tar.gz`
   and its `.sig` to the draft release. Only publishing the release runs `update-manifest.yml`,
   which writes `latest.json` to the `updater` branch; drafts are never offered.
7. **Versions only go up.** Each release has its own version, since the updater installs only
   a version newer than the running one. The release workflow takes it from the release branch's
   name (`release/vX.Y.Z`), never from commit messages, and refuses one already released or older
   than the last. Betas (`vX.Y.Z-beta.N`) are pre-releases downloaded by hand; only latest
   releases are offered by the updater.

## Consequences

- The privacy statement changes from "no network connections" to "no network connections
  except the update check, when you allow it" in the app, `PRIVACY.md`, the READMEs and the
  Chrome Web Store listing.
- The app gains `tauri-plugin-updater` and, through it, an HTTP client (`reqwest` with rustls).
- Losing the updater's private key means installed apps cannot be updated anymore: a new key
  needs a new app installed by hand. The owner keeps a backup of it.
- The app replaces itself in place. With an ad hoc signature, each build has a new signature;
  whether macOS then asks to "Open Anyway" again or resets launch at login is not verified yet,
  and becomes a non-issue once releases are signed with an Apple Developer ID.
- Apps from before this ADR (0.1.0) have no updater: they need one manual update.
