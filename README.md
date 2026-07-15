# Speakdown

Fast, lightweight, local-first markdown editor with offline voice dictation.

![Speakdown](./assets/screenshot.png)

It is built with Tauri v2, React, Zustand, CodeMirror, and Rust. The app keeps documents on disk, respects workspace `.gitignore` rules, supports multiple windows, renders extended markdown such as tables and Mermaid diagrams, and adds on-device voice dictation (speech-to-text) plus read-aloud. It ships with a macOS release flow (Apple signing optional).

## Credits & license

Speakdown is an independent fork of **Writer** by [joelbqz](https://github.com/joelbqz), extended with offline voice dictation — sherpa-onnx models and Apple's native on-device speech recognition — and read-aloud. Full credit to the original author for the base editor.

- Original project: **Writer** — https://github.com/joelbqz/writer-computer
- This fork: **Speakdown**, maintained by fluxorr — https://github.com/fluxorr/speakdown
- Licensed under **GPL-3.0**, same as upstream. See [`LICENSE`](./LICENSE). As required by the GPL, the complete source is public at the repository above.

## Repository

- `apps/desktop/` — Tauri desktop app.
- `apps/desktop/src/` — React frontend.
- `apps/desktop/src-tauri/src/` — Rust commands, workspace state, watcher, updater, and CLI integration.
- `apps/website/` — landing page.
- `docs/` — project and agent workflow docs.
- `SPECs/` — feature specs and design notes.

## Development

This repo uses Vite+ through the `vp` CLI. Use `vp` instead of calling the package manager or Vite tooling directly.

```bash
vp install
vp dev
```

## Validation

```bash
vp check
vp test
```

Rust validation runs from the Tauri crate:

```bash
cd apps/desktop/src-tauri
cargo test
cargo clippy
cargo fmt --check
```

## Installing (macOS)

Speakdown is distributed as an **unsigned** macOS app (it is not notarized through the Apple Developer Program). On first launch, Gatekeeper will warn that the app is from an unidentified developer. To open it, do one of:

- **Right-click** (or Control-click) `Speakdown.app` → **Open**, then **Open** again in the dialog. You only need to do this once.
- Or, from Terminal: `xattr -dr com.apple.quarantine /Applications/Speakdown.app`

## Releases

macOS releases are cut locally with `scripts/distribute.sh`. See `docs/releasing.md` for the release workflow and updater publishing details. Apple signing/notarization is optional — without it the app ships unsigned (see Installing above); the in-app auto-updater is signed with an independent minisign key.
