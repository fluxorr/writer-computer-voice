# Voice: Read-Aloud (TTS) + Dictation (STT)

Full voice feature for Writer: read the document aloud with word-level
highlighting, and dictate text directly into the editor via on-device speech
recognition. macOS-only for v1, fully offline (local-first).

## Goals

- **Read-aloud (TTS):** speak the document (or a chosen scope) using macOS
  native offline voices, with karaoke-style word/sentence highlighting in the
  editor and a small floating control.
- **Dictation (STT):** transcribe speech in real time and stream it into the
  editor at the cursor, using Whisper (whisper.cpp / Metal) locally, falling
  back to macOS native Dictation.
- Both are triggered by dedicated, user-customizable keyboard shortcuts.

## Non-Goals (v1)

- Cross-platform voice (Windows/Linux). macOS only.
- Voice control of the app UI (no "open search" style commands). STT inserts
  text only (plus punctuation/formatting commands).
- Cloud TTS/STT providers (ElevenLabs, Whisper API). Local-only.
- Voice in compact single-file windows. Workspace windows only.
- Streaming TTS model swapping / custom voice cloning.

## Platform & Engines

- **TTS:** macOS `AVSpeechSynthesizer` (offline, OS-managed voices). Whisper is
  ASR-only and is NOT used for speech synthesis.
- **STT:** `whisper-rs` (Rust bindings to whisper.cpp) running in-process on a
  Rust worker thread with Metal (ggml) acceleration. Model: **small** (~240MB),
  **auto-downloaded on first dictation use** and cached in the app data dir.
  Fallback: macOS native Dictation if Whisper/model is unavailable.
- Native APIs are reached via `cfg(target_os = "macos")` code only; other
  platforms compile but voice commands no-op with a clear message.

## Keyboard Shortcuts

Defaults (user-customizable in Settings, like other shortcuts):

- **Read-aloud:** `Cmd+Shift+R` — toggles play/pause; `Esc` (or Stop in the
  mini-player) stops and clears the highlight.
- **Dictation:** `Cmd+Shift+D` — toggles dictation on/off; `Esc` stops and
  commits the transcript.

These must not collide with existing shortcuts (`Cmd+P` search, `Cmd+Shift+F`
content search, `Cmd+F` in-editor find).

## Read-Aloud (TTS) Behavior

- **Scope (configurable per use):** on trigger, a small popover offers
  - _From cursor to end_ (default)
  - _Current selection_ (falls back to current paragraph if nothing selected)
  - _Whole document_
    The last choice is remembered in settings (`voice.tts.scope`).
- **Highlight:** as the synth speaks, the currently-spoken word/sentence is
  highlighted in the editor body (reuse the existing `cm-content-search-highlight`
  style or a dedicated `cm-tts-highlight`), and the editor auto-scrolls to keep
  it in view.
- **Mini-player UI:** a floating control (play/pause/stop + speed 0.5–2.0x)
  anchored near the editor. Hidden when idle.
- **Voice/rate/pitch:** chosen in Settings; applied to the synth.
- **Cancellation:** Stop clears the highlight and tears down the synth.

## Dictation (STT) Behavior

- **Trigger:** toggle on/off. While on, a recording indicator (mic dot) shows
  and an interim transcript preview streams at the cursor.
- **Insertion:** stream recognized text at the cursor, replacing any selection.
  Works anywhere in the document (prose, code blocks, frontmatter).
- **Language:** a single fixed language chosen in Settings (default **English
  / `en`**); Whisper runs with that language code (no per-utterance auto-detect).
- **Auto-punctuation + commands:** the model/normalization auto-inserts
  punctuation; spoken commands expand to formatting:
  - `new paragraph` / `new line` → newline
  - `period` / `comma` / `question mark` / `exclamation mark` / `colon` /
    `semicolon` → the punctuation
  - (exact command set finalized in the worksheet)
- **Interim vs final:** partial hypotheses stream live; on stop/commit, final
  text is written and the preview collapses into the document.
- **Fallback:** if Whisper/model is missing or fails, fall back to macOS native
  Dictation (user may need to enable in System Settings); surface a notice.
- **Mic permission:** request `NSMicrophoneUsageDescription`; if denied, show a
  clear message with the System Settings path.

## Settings (full panel)

New "Voice" section in Settings, backed by the existing `useSetting` store:

- `voice.tts.enabled` (implied), `voice.tts.voice` (voice identifier),
  `voice.tts.rate` (0.5–2.0, default 1.0), `voice.tts.pitch` (optional).
- `voice.tts.scope` (`cursor` | `selection` | `document`, default `cursor`).
- `voice.stt.language` (default `en`), `voice.stt.model` (default `small`),
  `voice.stt.autopunctuate` (default true).
- `voice.shortcut.read` (default `Cmd+Shift+R`),
  `voice.shortcut.dictate` (default `Cmd+Shift+D`).

## Architecture (backend)

- New Tauri commands (macOS-gated):
  - `voice_tts_speak { text, voice, rate, pitch, scope_hint }` → starts synth,
    emits `voice-tts-will-speak` events (char range) for highlighting, and
    `voice-tts-done` on finish. Stop command `voice_tts_stop`.
  - `voice_stt_start { language, model }` / `voice_stt_stop` → starts the
    Whisper worker + mic capture (via `cpal`), streams `voice-stt-partial`
    events (text + caret delta), and `voice-stt-done` on stop.
  - `voice_stt_ensure_model` → triggers/awaits model download, emits progress.
- Whisper model download: fetch from the whisper.cpp releases into
  `<app_data>/voice/whisper/<model>.bin`; cache and reuse.
- Mic capture: `cpal` 16kHz mono PCM → Whisper state (streaming inference).
- All voice commands are capability-gated where the Tauri ACL requires it and
  no-op with a clear error on non-macOS.

## Architecture (frontend)

- `hooks/use-voice-tts.ts` (speak/stop, event listener for will-speak ranges →
  apply highlight decoration, mini-player state).
- `hooks/use-voice-stt.ts` (start/stop, interim text streaming into the active
  editor at cursor via `editorApi`).
- `components/voice-tts-miniplayer.tsx` (floating control).
- `components/voice-stt-indicator.tsx` (recording dot + interim preview).
- Reuse the editor line-jump/highlight infrastructure for TTS word highlight
  (a dedicated `cm-tts-highlight` decoration + scroll-into-view).
- Command-palette entries: "Read aloud", "Start dictation" / "Stop dictation".
- Keyboard shortcuts wired in `use-keyboard-shortcuts.ts`.

## Tests

- Backend: model download path/ caching; Whisper transcribes a known sample
  (offline, small fixture or skipped if model absent); TTS command emits
  will-speak events for a fixed string (macOS-only, `#[cfg(target_os="macos")]`).
- Frontend: settings defaults; scope resolution (selection→paragraph); command
  wiring; mini-player/indicator render.

## Risks

- **Build weight:** whisper-rs compiles whisper.cpp (needs a C toolchain /
  cmake). Mitigated by caching; dev build may be slow.
- **Model download:** first-run network fetch; mitigate with progress UI +
  cached file + native fallback.
- **macOS signing:** mic + Metal require entitlements + notarization; releases
  already sign, so wire `NSMicrophoneUsageDescription` + entitlements now.
- **Highlight mapping:** synth char ranges must map back to editor document
  positions (the spoken text is a substring of the doc for cursor/selection
  scopes; for whole-doc it's the whole doc). Keep an offset from the spoken
  slice to the doc.
