# Worksheet: Voice — Read-Aloud (TTS) + Dictation (STT)

## Task

TODOS.md → new "Voice: read-aloud + dictation" task. Spec:
`SPECs/voice-read-aloud-dictation-spec.md`. macOS-only, offline.

## Reviewed

- `SPECs/voice-read-aloud-dictation-spec.md` — requirements above.
- `apps/desktop/src/components/editor-area/editor-line-jump.ts` — existing
  mark-decoration + scroll-into-view pattern to mirror for TTS highlight.
- `apps/desktop/src/lib/pending-line-jump.ts`, `editor-view-registry.ts`,
  `hooks/editor-api.ts` (`jumpToLine`) — editor targeting helpers.
- `apps/desktop/src/hooks/use-keyboard-shortcuts.ts` — shortcut wiring
  (mirror `Cmd+Shift+F` content search).
- `apps/desktop/src/stores/editor-store.ts`, `use-settings` / settings schema —
  for Voice Settings keys.
- `apps/desktop/src-tauri/src/commands/` (e.g. `search.rs`) — command +
  capability pattern; `lib.rs` `generate_handler!`.
- `apps/desktop/src-tauri/capabilities/default.json` — command permissions.
- `apps/desktop/src-tauri/tauri.conf.json` / macOS bundle — entitlements +
  `NSMicrophoneUsageDescription`.
- `docs/releasing.md` — signing/notarization flow (mic entitlements needed).

## Decisions (from Q&A)

- macOS only; TTS = `AVSpeechSynthesizer` (offline); STT = `whisper-rs` Metal,
  model `small`, auto-download 1st use, fallback native Dictation.
- Two shortcuts (defaults + customizable): Read `Cmd+Shift+R`, Dictate
  `Cmd+Shift+D`.
- TTS scope popover per trigger (cursor/selection/document), remember last.
- TTS: word/sentence highlight (karaoke) + mini-player (play/pause/stop/speed).
- STT: toggle on/off; stream at cursor; fixed language (default `en`);
  auto-punctuate + command words; indicator + live preview; anywhere in doc.
- Full Voice Settings panel. Workspace windows only.

## Changes

### Rust (`src-tauri`)

- `Cargo.toml`: add `whisper-rs` (Metal feature), `cpal`, `objc2`/`icrate`
  (AVFoundation) behind `cfg(target_os="macos")`. Add model-download dep
  (`reqwest` blocking or `tauri::api` fetch) — keep offline-friendly.
- `commands/voice.rs` (macOS-gated):
  - `voice_tts_speak` / `voice_tts_stop`: `icrate` AVSpeechSynthesizer; emit
    `voice-tts-will-speak` (utf-16/char range) + `voice-tts-done`.
  - `voice_stt_start` / `voice_stt_stop` / `voice_stt_ensure_model`: Whisper
    context load (download if missing), `cpal` mic → 16kHz mono → streaming
    infer; emit `voice-stt-partial` + `voice-stt-done`.
  - Model cache path in app data; download from whisper.cpp releases.
- `lib.rs`: register commands; capability entries in `default.json`.
- `tauri.conf.json` + `Entitlements.plist`: `NSMicrophoneUsageDescription`,
  mic + (if needed) Metal/CoreML entitlements.

### Frontend

- `types/fs.ts`: `VoiceTtsEvent`, `VoiceSttPartial`, settings types.
- `lib/tauri.ts`: `voiceTtsSpeak`, `voiceTtsStop`, `voiceSttStart`,
  `voiceSttStop`, `voiceSttEnsureModel` + event listeners.
- `hooks/use-voice-tts.ts`: speak/stop, will-speak → highlight decoration +
  scroll, mini-player state.
- `hooks/use-voice-stt.ts`: start/stop, stream partials into active editor at
  cursor via `editorApi`.
- `components/voice-tts-miniplayer.tsx`: floating control.
- `components/voice-stt-indicator.tsx`: recording dot + interim preview.
- `components/editor-area/voice-highlight.ts`: `cm-tts-highlight` StateField +
  decoration (+ scroll), mirror `editor-line-jump.ts`.
- Settings schema: `voice.tts.voice/rate/pitch/scope`, `voice.stt.language/
model/autopunctuate`, `voice.shortcut.read/dictate`.
- `hooks/use-keyboard-shortcuts.ts`: wire `Cmd+Shift+R` / `Cmd+Shift+D`
  (workspace only), respect customizable bindings.
- Command-palette entries: Read aloud / Start-Stop dictation.
- `App.tsx`: render mini-player + indicator.
- `App.css`: `.cm-tts-highlight`, mini-player/indicator styles.

## Order of execution (one commit per slice)

1. Spec + worksheet + TODOS (this doc).
2. Settings schema + Voice Settings panel.
3. TTS: Rust command (macOS) + frontend mini-player + highlight.
4. STT: model download + whisper-rs + cpal mic + streaming insert + indicator.
5. Shortcuts + command-palette entries.
6. Validation (`vp check`, `vp test`, `cargo test`, `cargo clippy`, `cargo fmt`)
   - CHANGELOG + final commit.

## Tests

- Backend (macOS `#[cfg]`): TTS emits will-speak for a fixed string; Whisper
  transcribes a tiny fixture (skip if model absent); model cache path.
- Frontend: settings defaults; scope resolution; command wiring; UI render.

## Risks

- whisper-rs build needs C toolchain/cmake; model download needs network 1st
  run; mic + Metal need signed/notarized entitlements (wire now).
- TTS char-range → doc-position mapping for highlight (track spoken slice
  offset within the document).

## Implementation notes (as built)

- **TTS uses the WebView's Web Speech API, not a Rust `AVSpeechSynthesizer`
  command.** On macOS the WebView's `SpeechSynthesis` drives the system's
  offline voices and emits `boundary` events, which give us the per-word
  highlight + auto-scroll with zero new Rust dependencies and no native
  delegate boilerplate. Behavior is still fully local-first. The Rust-side
  `voice_tts_*` commands from the original plan were not added. If a true
  separate native process is later required, add `AVSpeechSynthesizer` behind
  `#[cfg(target_os = "macos")]` and emit will-speak/done events.
- **STT is exactly as planned**: `whisper-rs` (whisper.cpp, Metal) + `cpal`
  mic + `rubato` resample to 16kHz mono, model auto-downloaded to app data on
  first use. Commands: `voice_stt_ensure_model`, `voice_stt_start`,
  `voice_stt_stop` (macOS-gated). Insertion streams at the cursor; the
  transcript is read from settings (`voice.stt.model/language/autopunctuate`).
- Shortcuts wired from settings (`voice.shortcut.read` = Cmd+Shift+R,
  `voice.shortcut.dictate` = Cmd+Shift+D), plus command-palette entries.
