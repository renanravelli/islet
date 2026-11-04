# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## Project

**Islet** (working name) replaces the Google Meet Picture-in-Picture window with an "island"
around the MacBook notch: who is speaking, mic state, call duration and, when expanded, meeting
controls. v0.1 = **macOS 13+ and Google Meet in Chrome**. The architecture must stay ready for
Windows, Linux and other meeting apps (Teams, Zoom, Slack) without implementing them.

- Repository: https://github.com/renanravelli/islet (public)
- Bundle ID and Native Messaging host name: `io.github.renanravelli.islet`
- License: `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`)
- Languages: code, commits, `README.md` and `docs/` in English; `README.pt-BR.md` is a full
  translation. The app UI ships pt-BR and en and follows the system language.

## Architecture principles (non-negotiable)

1. **Three layers:** core (session model and rules, no UI/OS), providers (one per meeting app),
   shell (OS windows and visuals). The UI never knows which app backs a session.
2. **Pluggable providers:** every provider implements the `Provider` trait and declares
   `capabilities`. The UI renders only declared controls. v0.1: `MeetProvider`, `DemoProvider`.
3. **Never show a state we do not know.** Media state is `On | Off | Unknown`; `Unknown` has its
   own neutral visual. No optimistic UI: state changes only when the provider confirms.
4. **Local-first:** no network calls, no telemetry, no accounts. Participant names stay in memory
   and never reach logs.
5. **Meet selectors are data** (`selectors.json`), with fallback strategies and health checks.
6. **Portability:** `protocol`, `core` and `provider-meet` build and test on macOS, Windows and
   Linux. OS code lives in dedicated modules behind `#[cfg(target_os = ...)]`, with stubs.
7. **Explicit degradation:** missing DOM elements mark the session `health: degraded` with
   reasons; the island shows a discreet indicator instead of wrong data.

Decisions and their rationale live in `docs/adr/` (0001 monorepo/Tauri, 0002 bridge, 0003
`Unknown` policy, 0004 selectors as data, 0005 keeping Meet rendering while hidden). Read the relevant ADR before changing those areas.

## Layout

| Path                                           | What lives there                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `crates/protocol` (`islet-protocol`)           | Versioned bridge messages (serde + ts-rs)                              |
| `crates/core` (`islet-core`)                   | Session model, pure reducer, `Provider` trait, `SessionManager`        |
| `crates/provider-meet` (`islet-provider-meet`) | Meet provider; gets protocol messages over a channel                   |
| `crates/provider-demo` (`islet-provider-demo`) | Scripted provider for demo mode and tests                              |
| `crates/native-host` (`islet-native-host`)     | Native Messaging host: Chrome stdio ⇄ app socket                       |
| `crates/bridge` (`islet-bridge`)               | Framing, socket server and client, socket path, host manifest install  |
| `apps/desktop`                                 | Tauri 2 + React app; OS code in `src-tauri/src/platform/`              |
| `extension/`                                   | Chrome MV3 extension; Meet adapter in `src/content/meet/`              |
| `packages/protocol-ts`                         | TS types generated from `crates/protocol` — never edit by hand         |
| `packages/ui-types`                            | TS types generated from `crates/core`, desktop UI only — never by hand |
| `docs/`                                        | Architecture, ADRs, provider guide, calibration, manual test checklist |
| `scripts/`                                     | Dev scripts (extension key, native host install, version bump)         |

Allowed extension IDs live in `crates/bridge/extension-ids.txt`; the host manifest and the
host's origin check both read it.

Rust crate packages are prefixed `islet-` so none is named `core`.

## Toolchain

- **Version pins, and which files must change together** (same commit):
  - Rust: `rust-toolchain.toml` (source of truth, used by CI and by anyone without asdf) and
    `.tool-versions`.
  - Node: `.tool-versions` and `engines.node` in `package.json`.
  - pnpm: only `packageManager` in `package.json`. asdf has no pnpm plugin; install pnpm with
    Homebrew, corepack or npm.
- Universal macOS builds need `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.
- TypeScript 7 is used only for `tsc --noEmit`. If any tool needs the TypeScript JS API, fall
  back to TypeScript 6.x.

## Unsafe code

- The portable crates (`islet-protocol`, `islet-core`, `islet-provider-meet`,
  `islet-provider-demo`, `islet-native-host`) inherit `unsafe_code = "forbid"` from the workspace.
- `apps/desktop/src-tauri` declares its own `[lints]` with `unsafe_code = "deny"` and allows it
  only in `src/platform/macos.rs` (`#![allow(unsafe_code)]`). Nowhere else.
  `tauri-nspanel`'s `tauri_panel!` expands to `unsafe` Objective-C calls, so the island panel is
  defined there too. The AppKit calls written by hand (screen geometry, preferred language) are
  safe in objc2 0.6 and need no `unsafe`.
- Every `unsafe` block carries a `// SAFETY:` comment explaining why it is sound.
  `clippy::undocumented_unsafe_blocks` is enabled in every crate and fails the build without it.

## Commands

```sh
pnpm install                                         # JS dependencies
pnpm lint                                            # Biome (lint + format check)
pnpm format                                          # Biome, apply fixes
pnpm typecheck                                       # tsc --noEmit in every package
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace                               # also regenerates the protocol TS types
```

```sh
scripts/gen-extension-key.sh --print                 # the extension's public key and ID
scripts/install-native-host.sh                       # dev: register target/debug host with Chrome
scripts/package-store-extension.sh [dir]             # the Chrome Web Store zip (no manifest key)
pnpm test                                            # Vitest in every package (extension)
pnpm build                                           # release extension in extension/dist, checked
pnpm --filter @islet/extension build:dev             # development extension, with isletDebug
```

The extension loads from `extension/dist` (`docs/install-extension.md`).

```sh
pnpm --filter @islet/desktop dev:app                 # the app with hot reload (also builds the host)
./target/debug/islet --demo                          # the app in demo mode, after a build
pnpm --filter @islet/desktop strings                 # regenerate the UI strings from the UI spec
pnpm --filter @islet/desktop build:app               # Islet.app with the native host inside
pnpm --filter @islet/desktop build:app:universal     # the same, universal (lipo'd sidecar)
```

`http://localhost:1420/gallery.html?locale=pt-BR` on the dev server shows every island state
with synthetic data (development only; not in the build). Outside Tauri the windows use an
in-memory stand-in for the shell (`src/shared/api.ts`); `?step=` and `?pane=` open a given
onboarding step or settings pane.

## Extension

- Permissions are `nativeMessaging` and `https://meet.google.com/*` only; a test fails on
  anything more. No `web_accessible_resources`: the content scripts are standalone IIFEs.
- Two content scripts. The adapter (`src/content/meet/index.ts`) runs in the isolated world.
  `keep-rendering.ts` runs in Meet's world at `document_start` and only reschedules animation
  frames while the tab is hidden, because Meet does not update its controls otherwise (ADR
  0005). The release check fails if it does anything more.
- Every Meet DOM dependency goes through `selectors.json`; nothing in the adapter queries the
  page directly. Selector keys are opaque `provider_details` in the core and must match
  `islet-provider-meet` (a test checks).
- Tests run against synthetic fixtures in `extension/test/fixtures`, marked as such. Real
  snapshots come only through `docs/meet-adapter/calibration.md`, anonymized and reviewed. The
  "fixtures are sanitized" test rejects e-mails, `googleusercontent.com` URLs, meeting codes and
  any name in the git-ignored `extension/test/.private-names.txt`.
- `isletDebug`, the snapshot capture and the calibration runner (`src/debug/`) exist only in
  development builds (`__ISLET_DEBUG__`). `scripts/check-release-build.mjs` fails a release
  build that contains them, a network API or extra permissions. The pasted scripts in
  `extension/scripts/` only start them.
- The calibration steps are data in `src/debug/steps.ts`; `docs/meet-adapter/calibration-session.md`
  must describe the same steps (a test checks).
- Log through `src/shared/log.ts`: fixed text plus non-personal details, never content.

## Bridge protocol

- `crates/protocol` is the source of truth. `cargo test` regenerates
  `packages/protocol-ts/src/generated/protocol.ts` (ts-rs; `TS_RS_EXPORT_DIR` in
  `.cargo/config.toml` points at `packages/`). Commit the regenerated file with the Rust change;
  a stale file is a bug. The same goes for `packages/ui-types` (from `islet-core`), which only
  the desktop UI may import.
- `packages/protocol-ts/src/index.ts` mirrors `PROTOCOL_VERSION` and `MAX_MESSAGE_BYTES`; a Rust
  test fails if they drift.
- `crates/protocol/fixtures/` holds one synthetic JSON per message. They are the compatibility
  contract: every fixture must decode and re-encode unchanged, on both sides.
- Within `v: 1`, only add optional fields. New variants, renamed or newly required fields need a
  new protocol version.
- Types that hold names, titles or meeting codes implement `Debug` by hand and redact them.
  Protocol errors keep only the line and column of a JSON error, never its text.

## Verifying work

Before every commit, run the checks above for the areas you touched; all must pass with zero
warnings. UI changes must also be checked in demo mode (`--demo`), with and without a notch.

## Product decisions (v0.1)

- **Global shortcuts (fixed):** `⌃⌥I` expand/collapse, `⌃⌥M` toggle mic. `⌃⌥Space` was rejected:
  it is macOS's default "Select next source in Input menu". If a shortcut fails to register,
  the tray shows a warning instead of failing silently.
- **Lifecycle numbers:** `Ended` lasts 5 s, then `Idle`; no heartbeat for 10 s → `degraded`
  (`stale`); command timeout 2 s; extension confirms a command within 1.5 s; DOM observer debounce
  150 ms; heartbeat every 5 s; messages over 64 KB rejected.
- **Native host:** the `connectNative` port is open only while a `meet.google.com` tab exists and
  closes 30 s after the last one (ADR 0002).
- **Design tokens (approved mock):** background `#000000`, text `#FFFFFF`, secondary text
  `#A1A1A6`, button surface `#2C2C2E`, active speech `#32D74B`, mic off / Leave `#FF453A`, alert /
  raised hand `#FF9F0A`, primary action `#0B63CE`. Compact: notch height (~32 pt), 390 pt wide,
  88 pt ears, 14 pt horizontal padding, 14 pt bottom radius. Expanded: 560 pt, 28 pt bottom radius,
  padding `0 20 18`, five 44 pt round buttons with 11 pt labels (chat is hidden). Alert: 440 pt, 22 pt radius, amber
  outline and glow. No-notch pill: 340×34 pt, fully rounded. Stroke SVG icons, no emoji. System
  font. Respect `prefers-reduced-motion`; text contrast ≥ 4.5:1.
- **Leave never ends the call for everyone.** When Meet asks the host whether to leave or end
  the call for everyone, the adapter picks "Sair da chamada" / "leave" (`justLeaveButton`). It
  refuses to click any control whose label ends the call for everyone, whatever a selector says
  (tested), and leaves a dialog it does not recognize for the person to answer.
- **Out of scope for v0.1:** Windows, Linux, Teams, Zoom, Slack, calendar reminders, speaker video
  thumbnails, OS-level call detection, system-level mute, Firefox, Safari. (The
  Chrome Web Store listing came after all, by the owner's decision on 2026-11-03.)

## UI rules

**`docs/design/ui-spec.md` is the required reference for Phase 5**: onboarding, settings, theming
and every UI string. Where it and the design canvas differ, the spec wins.

1. **Windows follow the macOS appearance (light/dark) live**, using the tokens in section 1 of the
   spec. There is no theme option in the app in v0.1.
2. **The island and the no-notch pill are always black**, in both themes, and never draw the
   camera dot.
3. **Every UI string comes from the pt-BR/en dictionary in section 6 of the spec.** No hard-coded
   text in components.
4. **Chat is hidden in v0.1.** The UI renders only the controls the provider declares, and no
   provider declares chat. Everything else follows the canvas's "Estados da ilha" board 1:1;
   `gallery.html` draws the same rows with the same data for comparison. Deliberate
   differences: no chat, no camera dot, no pre-call reminder (out of scope), a green camera
   icon in the right ear while the camera is on (ears widen when it does not fit), and the alert's
   amber glow is drawn inside the contour (rule 6); shadows outside the contour are the macOS
   window shadow (`IslandLayout.shadow`).
5. **Avatars:** initials on the canvas's three colors, given in the order people first appear
   (memory only). The expanded island shows up to three participants (`MAX_PARTICIPANTS` in
   `islet-core`), "+N" for the rest, and the count. With names off, the core makes them
   anonymous and the UI draws generic avatars. With nobody speaking, the island shows who
   spoke last, labelled `island.last_speaker`, and before anyone spoke the user, labelled
   `island.you`; both without the green ring or a moving wave: never as speaking.
6. **Strings are generated, not copied:** `apps/desktop/src/i18n/strings.json` comes from
   section 6 of the spec (`pnpm --filter @islet/desktop strings`); tests fail if it drifts or if
   a component has text outside it. Product and language names, which are not copy, live in
   `src/shared/meet.ts`.
7. **The island window is exactly the island's contour** (`island_layout`): no invisible area
   takes clicks. The active speaker is held 3 s after Meet's indicator goes off, because it
   follows the voice's level (gaps of up to 2 s between words, plus ~1 s with Chrome hidden).
8. **Onboarding and settings windows open hidden** with the theme's background and show once
   the page has painted (`window_ready`), so dark mode never flashes white.

## Pending by phase

Every open item lives here, not in an assistant's memory. Remove an item when it lands.

- **Manual, needs a real call (owner):**
  - **pt-BR session done (2026-11-03, `docs/meet-adapter/reports/`).** Verified in pt-BR:
    `micButton`, `camButton`, `handButton`, `leaveButton`, `participantCount`. Still open:
    - `activeSpeaker`: an unverified strategy from one sample (obfuscated classes); needs a
      session alternating who speaks.
    - `mutedSpeakingNotice`: the bubble is a `[role='dialog']` whose `aria-label` is "Você está
      falando? O microfone está desativado." (found once, 2026-11-03), and it counts only while
      on screen. Check that the island's alert shows and clears with it (setting on), whether
      Meet shows it with the tab hidden, and the English text.
    - `meetingTitle`: only the instant-meeting case is known, where Meet shows the meeting code
      in the title slot (the island shows it too, as Meet does); check a calendar meeting.
    - `selfTile`: unverified, from one call with two people (the own tile has a
      `jsname='Ac69Jc'` control); check with 3+ people and with the self view hidden.
    - Only video tiles count (`jsname='E2KThb'`): the People panel's list items also carry
      `data-participant-id`, and one of them gave a stray "D" avatar (an icon's text).
    - `participantTile`: unverified (the speaker strategy's tiles and name); check the avatar
      row's names with 3+ people, and whether Meet renders a person in two tiles.
    - Short session (2026-11-03): `justLeaveButton` verified in pt-BR (left in 674 ms, the
      call went on). Silence gave no false speaker. Only the iPhone's tile ever lit up, also in
      the "Mac talks" step (detected after 55 s, with the Mac's mic off at capture): the
      speaker strategy seems to see remote speakers but not the user; it flickers with the
      audio level (2 to 4 of 20 samples), so the island needs to hold the last speaker ~2 s.
    - One `toggle_mic` was not confirmed in 1.5 s in step 6 (it worked every other time, in
      53 to 59 ms). Probable cause, per the owner: the mic was also toggled by hand around then.
      Watch for it in the next session.
  - **Later:** the English round; until then no key lists `en` in `verifiedIn`.
  - With Chrome in the background (ADR 0005): confirm the island stays in sync after 10+
    minutes hidden, and whether the active speaker is detected while hidden.
  - The hand reads `Unknown` for about 200 ms while its label changes; the island may need to
    hold the last known hand state briefly, like the speaker.
  - **After Phase 5:** check that `focus_tab` brings Chrome to the front from another app on
    macOS, and that a connection from another macOS user is refused by the bridge.
- **Phase 5, to check by hand on the Mac (owner):** the acceptance list in section 7 of
  `docs/design/ui-spec.md`, in the real app: light/dark switching while a window is open, no
  white flash, the tray icon tinting, VoiceOver on every control, the island over full-screen
  apps and on every Space, the pill on an external display without a notch, ⌃⌥I and ⌃⌥M, Esc /
  click outside / 6 s collapse, launch at login, and the app moved to `/Applications` (its
  manifest is repaired on the next start).
- **Phase 6 (docs):**
  - `CONTRIBUTING.md`: ways to install pnpm (Homebrew, corepack, npm).
  - The READMEs' images in `docs/assets/` and the Chrome Web Store screenshots in
    `docs/assets/store/` (1280×800 JPEG, pt-BR) are renders of the design canvas, with chat and
    the pre-call reminder removed. Replace them with real screenshots and a demo-mode GIF once the app
    ships, and fill the READMEs' remaining `TODO` (the security contact).
  - The READMEs must not link to ADRs, the UI spec or other internal design documents (the
    owner's rule).
  - `SECURITY.md`: GitHub's private vulnerability reporting is off on the repository; turn it on
    (owner) and point to it.
  - Threat model: the development extension ID can be reproduced by anyone from the public key.
  - `docs/testing/manual-checklist.md`, including the Meet section `calibration.md` points to.
- **Phase 7 (CI), still open:** Dependabot (cargo, npm, actions), the bug and feature issue
  templates, the pull request template and `CODEOWNERS`.
- **Signing (owner):** the release is signed ad hoc until the six `APPLE_*` secrets exist (an
  Apple Developer Program membership); then `release.yml` signs and notarizes.
- **Next version, extension install (the owner's decision, 2026-11-03):** v0.1 keeps the
  manual "Load unpacked" guide; non-technical users get stuck on onboarding step 2.
  - **Chrome Web Store (submitted 2026-11-03, review pending):** ID
    `lbhmocnfnfmbiplpkllkacnbcjfcmlop`, already in `extension-ids.txt` and `EXTENSION_STORE_URL`
    (the onboarding's "Install extension" opens it). The store refuses a manifest `key`, so
    upload `scripts/package-store-extension.sh`'s zip; the release zip keeps the development ID.
    On macOS nothing else can install it for the user: off-store external installs are refused,
    and branded Chrome dropped `--load-extension` in 137. Once approved: release the app (the
    store ID needs a new host manifest), and make the READMEs and `docs/install-extension.md`
    recommend the store, with "Load unpacked" as the alternative.
  - Optionally, also write `~/Library/Application Support/Google/Chrome/External
    Extensions/<id>.json` (`external_update_url`), so Chrome asks to enable it on its next start.
  - Step 2 waits forever without a `meet.google.com` tab, since the extension connects only
    while one exists (ADR 0002), and nothing tells the user: add an "open Meet" step and button.

## Git

- Conventional Commits. Default branch `main`, remote `origin`.
- Push to `main` only after checks are green. **Never force push.**
- **CI** (`.github/workflows/ci.yml`): the portable crates on Linux, macOS and Windows (`-p`,
  since `islet-desktop` needs Tauri's system libraries on Linux); the workspace, a stale
  generated-types check and the universal app on macOS; lint, typecheck, test and build of the
  JS packages.
- **Releasing:** the version lives in `Cargo.toml` (`workspace.package`), `tauri.conf.json`,
  `extension/manifest.json` and the `package.json` files. Push a tag `v<version>` (or
  `v<version>-beta.N`, a pre-release) on a green `main`; `release.yml` builds the universal DMG
  and `islet-extension-<version>.zip` and attaches them, with `SHA256SUMS.txt`, to a **draft**
  release. Review the notes, then publish. Without the `APPLE_*` secrets the app is signed ad
  hoc, which macOS opens through Privacy & Security → Open Anyway.
- `KICKOFF.md` is a local planning file excluded via `.git/info/exclude`; it is not part of the
  repository. Durable decisions belong in this file and in `docs/adr/`.

## Never

- Commit private keys, certificates, tokens or the extension `.pem` (all in `.gitignore`).
- Add network calls, telemetry or analytics.
- Log participant names or other personal data.
- Show a media state as "on" when it is `Unknown`, or update it optimistically.
- Read the Meet chat, capture audio/video, or make requests from the extension.
- Put a placeholder Chrome Web Store ID in the host manifest's `allowed_origins`.
- Enable `macOSPrivateApi` / `macos-private-api` (not needed since Tauri 2.12.1).
- Invent versions, APIs, screenshots, badges for services that do not exist, or numbers.
- Add Tauri, UI or OS dependencies to `islet-core`.
- Write anything but Chrome frames to the native host's stdout (logs go to stderr).
