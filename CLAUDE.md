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
```

Commands for the extension and the desktop app are added here as each phase lands.

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
  padding `0 20 18`, six 44 pt round buttons with 11 pt labels. Alert: 440 pt, 22 pt radius, amber
  outline and glow. No-notch pill: 340×34 pt, fully rounded. Stroke SVG icons, no emoji. System
  font. Respect `prefers-reduced-motion`; text contrast ≥ 4.5:1.
- **Out of scope for v0.1:** Windows, Linux, Teams, Zoom, Slack, calendar reminders, speaker video
  thumbnails, OS-level call detection, system-level mute, Firefox, Safari, Chrome Web Store
  publication.

## Pending by phase

Every open item lives here, not in an assistant's memory. Remove an item when it lands.

- **Phase 4 (extension):**
  - Put the public key from `crates/bridge/extension-ids.txt` in the extension manifest's `key`
    and add a test that it derives to the development ID listed there.
  - Service worker: answer `ping` with `pong` and re-send every meeting tab's state at once;
    treat `error: app_not_running` as "app closed" without tearing down the port.
  - Run `scripts/install-native-host.sh` against the real Chrome and load the unpacked extension.
  - `islet-provider-meet`: map protocol ⇄ core (`selectors.json` keys → core degraded reasons,
    session ids per connection + tab), track command ids and their results, send `ping` when a
    host connects so the extension re-sends its state at once.
- **Phase 5 (desktop app):**
  - Apply the unsafe rules for `src-tauri` (see "Unsafe code").
  - `packages/ui-types`: TS types for `UiSnapshot` and the other UI-facing core types, generated
    with ts-rs. Never put them in `packages/protocol-ts`: the extension must not import app types.
  - Core settings: a struct with `show_participant_names` (default on). When off, the
    `SessionManager` strips names and titles before publishing the `UiSnapshot`; the UI never
    receives them.
  - Core diagnostics without personal data, for "Copy diagnostics": provider, extension version,
    health, latest degraded reasons, time of the last update, connection state.
  - On every start, and from "Reinstall Chrome bridge", call `islet_bridge::manifest` to check and
    repair the host manifest (the binary path changes when the app is moved, e.g. to
    `/Applications`).
  - Glue the bridge socket server to `islet-provider-meet`.
  - `docs/design/ui-spec.md` lists the failing _selector keys_ under "Saúde do adaptador": keep
    the provider's raw keys next to the provider-agnostic `DegradedReason` (for example a
    provider detail field) so the settings pane and the diagnostics can show them.
- **Phase 6 (docs):**
  - `CONTRIBUTING.md`: ways to install pnpm (Homebrew, corepack, npm).
  - `docs/install-extension.md`: the manual "Load unpacked" guide the onboarding opens while
    `EXTENSION_STORE_URL` is unset (`docs/design/ui-spec.md`, step 2).
  - Biome formats Markdown. If it rewrites the README's centered HTML header, the badges or the
    Mermaid blocks, turn Markdown formatting off.
  - Threat model: the development extension ID can be reproduced by anyone from the public key.
- **Phase 7 (CI):**
  - After `cargo test`, fail if `packages/protocol-ts` (and later `packages/ui-types`) changed
    (`git diff --exit-code`).

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
