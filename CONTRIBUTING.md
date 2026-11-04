# Contributing to Islet

Thanks for helping. Bug reports, fixes, Meet selector updates and work toward new platforms and
meeting apps are all welcome.

## Before you start

- **Small fixes:** open a pull request directly.
- **Larger changes** (a new feature, a new provider, a change to the bridge protocol): open an
  issue first, so we can agree on the approach before you write the code.
- **Meet changed its interface?** Use the "Meet UI changed" issue template and paste the result
  of **Settings → Integrations → Copy diagnostics**. Never paste participant names, meeting
  titles, meeting codes or screenshots of a real call.
- **Security issues:** please do not report them in public issues.

## How to contribute

Only maintainers can push to this repository, so contributions come from your own fork:

1. Fork [renanravelli/islet](https://github.com/renanravelli/islet) and clone your fork.
2. Create a branch from `main`, such as `fix/hand-state-unknown`.
3. Make your change, with tests, and run the [checks](#checks).
4. Commit with [Conventional Commits](https://www.conventionalcommits.org)
   (`fix(extension): …`, `feat(core): …`, `docs: …`).
5. Push to your fork and open a pull request to `main`, filling in the template.

On your first pull request, a maintainer approves the CI run before it starts. The five CI jobs
must be green before a pull request is merged; merges are squash or rebase, so `main` keeps a
linear history. Keep each pull request to one change: they are easier to review and to revert.

## Setting up

The app is macOS only for now (macOS 13 or later). The portable crates (`islet-protocol`,
`islet-core`, `islet-provider-meet`, `islet-provider-demo`, `islet-bridge`,
`islet-native-host`) and the extension build and test on macOS, Windows and Linux.

| Tool    | Version                                 | How                                                                  |
| ------- | --------------------------------------- | -------------------------------------------------------------------- |
| Rust    | `rust-toolchain.toml`                   | Install [rustup](https://rustup.rs); it picks the pinned toolchain.  |
| Node.js | `.tool-versions`                        | Any version manager, such as asdf, or the installer from nodejs.org. |
| pnpm    | `packageManager` in `package.json`      | One of the options below.                                            |
| Chrome  | Google Chrome (not Beta, Dev or Canary) | To load the development extension.                                   |

To install pnpm, use one of:

```sh
corepack enable          # ships with Node.js; uses the version in package.json
brew install pnpm        # Homebrew
npm install -g pnpm      # npm
```

For a universal (Apple silicon and Intel) build, also run
`rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

Then:

```sh
pnpm install
pnpm --filter @islet/extension build:dev   # the development extension, in extension/dist
scripts/install-native-host.sh             # register the development host with Chrome
pnpm --filter @islet/desktop dev:app       # the app, with hot reload
```

Load `extension/dist` in `chrome://extensions` with **Load unpacked**
([guide](docs/install-extension.md)). To work on the island without a call, run the app in demo
mode (`./target/debug/islet --demo`, or **Demo mode** in the menu bar; development builds only), or open
`http://localhost:1420/gallery.html?locale=pt-BR` on the dev server, which draws every state.

## Checks

These are the checks CI runs. All must pass with no warnings:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`cargo test` also regenerates the TypeScript types in `packages/protocol-ts` and
`packages/ui-types`. Commit them with your change: CI fails when they are stale. Run `pnpm format`
to apply Biome's fixes.

## Project rules

Pull requests are reviewed against these. The reasons behind most of them are in
[`docs/adr/`](docs/adr).

- **Never show a state we do not know.** Mic, camera and hand are `On`, `Off` or `Unknown`, and
  the UI changes only when the provider confirms; no optimistic updates.
- **Privacy:** no telemetry, analytics or accounts, and no network calls. The in-app updater is
  the only exception (ADR 0006). Participant names, meeting titles and meeting codes never reach
  logs, error messages or test fixtures. The extension never reads the chat and never captures
  audio or video.
- **Meet's DOM lives in `selectors.json`.** Nothing in the adapter queries the page directly; add
  or fix a selector key, with a fallback strategy where you can.
- **Test fixtures are synthetic.** Never commit a real page snapshot; the "fixtures are
  sanitized" test rejects e-mails, meeting codes and photo URLs.
- **Layers:** `islet-core` knows nothing about Meet, Tauri or the OS; providers declare their
  capabilities, and the UI renders only the controls a provider declares.
- **The bridge protocol** is defined in `crates/protocol`. Within `v: 1`, only add optional
  fields; anything else needs a new protocol version.
- **UI text** comes from section 6 of `docs/design/ui-spec.md`: edit the table there, then run
  `pnpm --filter @islet/desktop strings`. Components contain no hard-coded text.
- **UI changes** follow `docs/design/ui-spec.md`. Check them in demo mode, with and without a
  notch, in light and dark appearance.
- **Extension permissions** stay `nativeMessaging` and `https://meet.google.com/*`; a test fails
  on anything more.
- **`unsafe`** is allowed only in `apps/desktop/src-tauri/src/platform/macos.rs`, and every block
  needs a `// SAFETY:` comment.
- **Dependencies:** prefer none. Explain each new one in the pull request.

## Releases

Maintainers cut releases from `release/vX.Y.Z` branches (betas on every push, the release when the branch is merged into `main`); contributors never need to.

## License

Islet is dual licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE). Unless you
explicitly state otherwise, any contribution you intentionally submit for inclusion, as defined
in the Apache-2.0 license, is dual licensed as above, without any additional terms or
conditions.
