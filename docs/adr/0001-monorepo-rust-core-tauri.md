# ADR 0001 — Monorepo with a Rust core and a Tauri desktop shell

- Status: Accepted
- Date: 2026-11-03

## Context

Islet replaces the Google Meet Picture-in-Picture window with an "island" around the MacBook
notch. v0.1 targets macOS and Google Meet only. The architecture must not prevent Windows and
Linux shells, or providers for other meeting apps (Teams, Zoom, Slack).

## Decision

1. **One monorepo** holding the Rust crates, the Tauri app, the Chrome extension and the generated
   TypeScript protocol types. Cargo workspace for Rust, pnpm workspaces for JS.
2. **Three independent layers:**
   - **Core** (`crates/core`, package `islet-core`): session model, pure reducer, `Provider`
     trait, capabilities, `SessionManager`. No Tauri, UI or OS dependencies.
   - **Providers** (`crates/provider-*`): one adapter per meeting app. v0.1 ships
     `islet-provider-meet` and `islet-provider-demo`. The UI only renders controls the provider
     declares in its capabilities and never knows which app is behind a session.
   - **Shell** (`apps/desktop`): Tauri 2 + React. All OS-specific code lives in
     `src-tauri/src/platform/{macos,windows,linux}.rs` behind `#[cfg(target_os = ...)]`, with
     stubs on the other platforms.
3. **Crate names are prefixed `islet-`.** Folders stay short (`crates/core`), but no package is
   named `core`, which would shadow Rust's built-in `core` crate.
4. **Portability is enforced by CI:** `islet-protocol`, `islet-core` and `islet-provider-meet`
   build and pass tests on macOS, Windows and Linux.
5. **macOS window surface:** the island is an `NSPanel` via `tauri-nspanel` **>= 2.1.1**
   (earlier versions let a click activate the app, ahkohd/tauri-nspanel#123).
6. **`macOSPrivateApi` is not used.** Since Tauri 2.12.1 the setting is a no-op and transparent
   windows work without it. We do not enable the config key or the `macos-private-api` feature.
7. **The native host ships inside the `.app`** as a Tauri sidecar (`bundle.externalBin`). For
   universal builds, the per-arch binaries are merged with `lipo` into
   `native-host-universal-apple-darwin` before bundling.
8. **Tooling:** Rust stable pinned in `rust-toolchain.toml`; Biome for TS lint/format;
   `rustfmt` + `clippy -D warnings` for Rust. TypeScript 7 is used only as a type checker
   (`tsc --noEmit`); if any tool needs the TypeScript JS API, we fall back to TypeScript 6.x.

## Consequences

- Adding a platform means implementing one `platform/<os>.rs` module, not touching the core.
- Adding a meeting app means adding one provider crate (see `docs/providers.md`).
- Rust is required to build the app and the native host, even for JS-only contributors.
