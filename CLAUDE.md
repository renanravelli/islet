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
`Unknown` policy, 0004 selectors as data). Read the relevant ADR before changing those areas.

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
pnpm test                                            # Vitest in every package (extension)
pnpm build                                           # release extension in extension/dist, checked
pnpm --filter @islet/extension build:dev             # development extension, with isletDebug
```

The extension loads from `extension/dist` (`docs/install-extension.md`). Commands for the desktop
app are added in Phase 5.

## Extension

- Permissions are `nativeMessaging` and `https://meet.google.com/*` only; a test fails on
  anything more. No `web_accessible_resources`: the content script is a standalone IIFE.
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
  `packages/protocol-ts/src/generated/protocol.ts` (ts-rs, via `TS_RS_EXPORT_DIR` in
  `.cargo/config.toml`). Commit the regenerated file with the Rust change; a stale file is a bug.
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
  thumbnails, OS-level call detection, system-level mute, Firefox, Safari, Chrome Web Store
  publication.

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
   provider declares chat.

## Pending by phase

Every open item lives here, not in an assistant's memory. Remove an item when it lands.

- **Manual, needs a real call (owner):**
  - **pt-BR session done (2026-11-03, `docs/meet-adapter/reports/`).** Verified in pt-BR:
    `micButton`, `camButton`, `handButton`, `leaveButton`, `participantCount`. Still open:
    - `activeSpeaker`: an unverified strategy from one sample (obfuscated classes); needs a
      session alternating who speaks.
    - `mutedSpeakingNotice`: not detected; confirm whether the notice appeared and its exact
      pt-BR text, then redo `runCalibration("muted-speaking")`.
    - `meetingTitle`: only the instant-meeting case (the code, dropped) is known; check a
      calendar meeting.
    - Short session (2026-11-03): `justLeaveButton` verified in pt-BR (left in 674 ms, the
      call went on). Silence gave no false speaker. Only the iPhone's tile ever lit up, also in
      the "Mac talks" step (detected after 55 s, with the Mac's mic off at capture): the
      speaker strategy seems to see remote speakers but not the user; it flickers with the
      audio level (2 to 4 of 20 samples), so the island needs to hold the last speaker ~2 s.
      The only live notice text recorded while talking muted was "Seu microfone está
      desativado.", which may be the screen-reader announcement of muting rather than the
      "are you talking?" notice; to be confirmed by the owner.
    - One `toggle_mic` was not confirmed in 1.5 s in step 6 (it worked every other time, in
      53 to 59 ms). Probable cause, per the owner: the mic was also toggled by hand around then.
      Watch for it in the next session.
  - **Later:** the English round; until then no key lists `en` in `verifiedIn`.
  - **After Phase 5:** check that `focus_tab` brings Chrome to the front from another app on
    macOS, and that a connection from another macOS user is refused by the bridge.
- **Phase 5 (desktop app):**
  - Apply the unsafe rules for `src-tauri` (see "Unsafe code").
  - `packages/ui-types`: TS types for `UiSnapshot` and the other UI-facing core types, generated
    with ts-rs. Never put them in `packages/protocol-ts`: the extension must not import app types.
  - Both of these live in `islet-core`, not in the shell:
    - Settings: a struct with `show_participant_names` (default on). When off, the
      `SessionManager` strips names and titles before publishing the `UiSnapshot`; the UI never
      receives them (the spec then shows a generic avatar, no initials).
    - Diagnostics without personal data, for "Copiar diagnóstico": provider, extension version,
      health, latest degraded reasons, time of the last update, connection state. A test checks
      that the output has no names, titles or meeting codes.
  - The manifest repair routine from Phase 3 (`islet_bridge::manifest::ensure_chrome_manifest`) is
    the one routine behind all three entry points: every app start, step 2 of the onboarding
    (when the step mounts) and the "Reinstalar ponte do Chrome" button. The binary path changes
    when the app is moved, e.g. to `/Applications`.
  - Glue the bridge socket server to `islet-provider-meet`.
  - "Saúde do adaptador" shows `Health::Degraded.provider_details` as they come (the failing
    selector keys); the diagnostics include them too.
  - The onboarding's "Não conectou? Ver solução de problemas" opens
    `docs/install-extension.md#troubleshooting` on GitHub.
  - The app's own logs go to `islet_bridge::path::log_dir()` (the native host already writes
    there), so "Abrir pasta" shows both.
- **Phase 6 (docs):**
  - `CONTRIBUTING.md`: ways to install pnpm (Homebrew, corepack, npm).
  - Biome formats Markdown. If it rewrites the README's centered HTML header, the badges or the
    Mermaid blocks, turn Markdown formatting off.
  - Threat model: the development extension ID can be reproduced by anyone from the public key.
  - `docs/testing/manual-checklist.md`, including the Meet section `calibration.md` points to.
- **Phase 7 (CI):**
  - After `cargo test`, fail if `packages/protocol-ts` (and later `packages/ui-types`) changed
    (`git diff --exit-code`).
  - Run `pnpm test` (which includes the fixture sanitization test) and `pnpm build` (which
    includes the release build check) on every push.
  - The release attaches `islet-extension-<version>.zip` (built `extension/dist`), as
    `docs/install-extension.md` describes.
  - Issue template "Meet UI changed", which `docs/install-extension.md` mentions.

## Git

- Conventional Commits. Default branch `main`, remote `origin`.
- Push to `main` only after checks are green. **Never force push.**
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
