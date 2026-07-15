# Voice: Streaming Dictation via sherpa-onnx (Transducer) + native Apple engine

Replace the Whisper (whisper-rs) dictation engine with **sherpa-onnx** so
dictation feels instantaneous: NeMo Transducer models (NVIDIA Nemotron /
Parakeet) emit tokens frame-by-frame while the user is still speaking, instead
of waiting for a full utterance to finish. This is the "Fluid" feel from
FluidVoice, achieved natively in Rust — no Swift sidecar, no Python runtime.

A third **`apple-native`** engine is offered alongside the two sherpa models: it
uses Apple's built-in on-device `SFSpeechRecognizer` (via a small Objective-C
bridge) with no model download. The `voice.stt.engine` setting selects the
engine; a picker on the dictation indicator switches engine + model at runtime.

## Why

Whisper is an encoder-decoder model: it must hear a whole chunk before it
guesses text, so the current dictation waits for a pause (VAD endpoint) and
then transcribes the whole utterance at once. That reads as "clunky/delayed."
Transducer (RNN-T / TDT) models decode one token per audio frame, so partial
hypotheses stream continuously and finalize only when the utterance ends.

## Goals

- Run Parakeet / Nemotron locally and offline via the official `sherpa-onnx`
  Rust crate (prebuilt static libs auto-downloaded for macOS arm64 — no C++
  toolchain in the build).
- Stream **partial** hypotheses (live, replaceable) and **final** text (committed
  to the document) — partial text renders as a greyed overlay at the cursor and
  is committed on utterance end (pause / stop).
- Both models selectable in Settings:
  - `nemotron-streaming` → `sherpa-onnx-nemotron-speech-streaming-en-0.6b-int8-2026-01-14` (default; built for true frame-by-frame RNN-T streaming → live partial overlay).
  - `parakeet-tdt-v3` → `sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` (TDT, 25 langs). TDT models export **without** the streaming `window_size`/`chunk_shift` metadata the `OnlineRecognizer` requires, so they run through the `OfflineRecognizer` (utterance-buffered, commit-on-pause; no live partials).
- Offer a native, download-free engine (`apple-native`) using Apple's on-device
  `SFSpeechRecognizer`, selectable via `voice.stt.engine` and switchable at
  runtime from a picker on the dictation indicator.
- Keep macOS-only gating; non-macOS no-ops with a clear message.

## Non-Goals

- Keeping whisper-rs as a fallback (replaced entirely; smaller bundle, cleaner code).
- VAD model (silero) — the recognizer's built-in endpointing rules handle
  utterance boundaries, which is all we need for commit-on-pause.
- Multi-language selection at runtime (these streaming models are effectively
  English; `voice.stt.language` is retained for future use but currently unused).

## Backend (`src-tauri/src/commands/voice.rs`)

- Drop `whisper-rs`; add `sherpa-onnx`, `tar` (+bzip2) on the macOS target. Keep
  `cpal`, `rubato`, `reqwest`, `futures-util`.
- A model registry maps the Settings `voice.stt.model` id → GitHub-release
  `.tar.bz2` (from `k2-fsa/sherpa-onnx` `asr-models`) + expected filenames.
- `voice_stt_ensure_model(model)` downloads + extracts the archive into
  `<app_data>/voice/models/<id>/`, auto-discovers `encoder/decoder/joiner`
  `.onnx` + `tokens.txt` by globbing (robust to internal folder naming), and
  emits `voice-stt-model` progress / ready / error.
- `voice_stt_start(model, language, autopunctuate)`:
  - Picks the worker based on the model's `streaming` flag (set in the registry): - **streaming (`nemotron-streaming`)** → `run_streaming_worker`: loads an
    `OnlineRecognizer` with `model_type = "nemo_transducer"`, `provider =
"cpu"`, greedy search, endpointing on, `feat_config.sample_rate = 16000`.
    Opens a `cpal` mic stream, resamples to 16 kHz mono with `rubato`, pushes
    samples into an `OnlineStream`. Every ~60 ms drains captured audio,
    `accept_waveform`, `while is_ready { decode; get_result }`, emits
    `voice-stt-partial` with the current hypothesis; on `is_endpoint` emits
    `voice-stt-final` and `reset`s the stream. - **non-streaming (`parakeet-tdt-v3`)** → `run_offline_worker`: loads an
    `OfflineRecognizer` (same `nemo_transducer` config). Buffers resampled
    audio for the current utterance; when a ~0.7 s trailing silence is detected
    (or dictation stops) it runs one offline decode and emits `voice-stt-final`.
    No `voice-stt-partial` events for this model.
  - Both workers emit `voice-stt-level` (RMS) for the waveform indicator and use
    epoch/cancel guards so a detached worker can't emit stale text.
- `voice_stt_stop()` flushes a tail of silence, decodes the final frames, emits
  any trailing `voice-stt-final`, then `voice-stt-status` idle.
- Non-macOS stubs return clear errors.

### Apple native engine (`apple-native`)

- **Objective-C bridge** (`src-tauri/src/apple_speech.{h,m}`, compiled + linked by
  `build.rs` via the `cc` crate against `Speech` / `AVFoundation` /
  `AudioToolbox`). Exposes a small C API called over FFI from `voice.rs`:
  `apple_speech_request_authorization`, `apple_speech_start`,
  `apple_speech_stop`, `apple_speech_abort`.
- Uses `SFSpeechRecognizer` (locale `en-US`, `requiresOnDeviceRecognition = YES`)
  fed by an `AVAudioEngine` input tap resampled to 16 kHz mono. The bridge
  streams the **full running transcript** as partials and commits it once as a
  single final on stop; intermediate `isFinal` segments are folded into a
  committed prefix so the caller never double-inserts.
- `voice.rs` adds an `engine` param to `voice_stt_ensure_model` /
  `voice_stt_start` and branches on `ENGINE_APPLE`:
  - `ensure_model` → requests authorization; emits `voice-stt-model` ready/error
    (mirrors the sherpa download flow so the frontend's start-after-ready path is
    shared). Requires `NSSpeechRecognitionUsageDescription` in `Info.plist`.
  - `start` → boxes an `AppleCtx { window, rt, epoch }`, passes it as the opaque
    callback context; the bridge's `on_partial/on_final/on_error/on_level`
    callbacks emit the same `voice-stt-*` events as the sherpa workers (epoch
    guarded). No cpal/rubato/worker thread — the bridge owns capture.
  - `stop` → takes the session out of the runtime (never holds the lock across
    the FFI call, so the synchronous `on_final` callback can't deadlock), calls
    `apple_speech_stop`, frees the boxed ctx, emits idle.
  - On a recognition error the bridge is aborted (mic stopped, no final) and the
    runtime reset so a later start works.

## Frontend

- `lib/tauri.ts`: replace `VoiceSttDelta` with `VoiceSttPartial { text }` and
  `VoiceSttFinal { text }`; keep `VoiceSttLevel`, `VoiceSttStatus`,
  `VoiceSttModelStatus`.
- `hooks/use-voice-stt.ts`: on partial → update live overlay (greyed) at the
  captured cursor; on final → commit into the doc at the cursor (space-joining
  mid-word, like today) and clear the overlay; on stop/idle → clear overlay.
- `components/editor-area/dictation-overlay.ts`: new CodeMirror widget
  decoration anchored at the committed-end position, showing the live partial
  text greyed with a subtle caret glow. Wired into `use-prosemark-editor.ts`
  extensions and styled in `App.css` (`.cm-dictation-overlay`).
- `components/voice-stt-indicator.tsx`: keep the waveform pill; also surface the
  live partial text for when the editor isn't focused.
- Settings schema (`shared/settings.schema.json`): `voice.stt.model` options
  become `nemotron-streaming` / `parakeet-tdt-v3` (default `nemotron-streaming`);
  refresh `voice.stt.language` / `voice.stt.autopunctuate` descriptions.

## Keyboard Shortcuts

Unchanged: `Cmd+Shift+D` toggles dictation (kept from the Whisper feature).

## Tests

- Backend: model registry url/filename resolution; archive extraction +
  file discovery helper; endpoint/reset logic on a synthetic audio stream
  (offline, tiny fixture or skipped if model absent).
- Frontend: settings defaults; partial→overlay / final→commit transitions;
  command wiring; overlay render.

## Risks

- **Model download size:** Nemotron ~250 MB, Parakeet ~490 MB, fetched on first
  use (progress UI + cached, same as before).
- **sherpa-onnx build:** prebuilt static libs auto-download for the host arch;
  if a future arch lacks a prebuilt, set `SHERPA_ONNX_LIB_DIR` (documented).
- **Endpoint tuning:** trailing-silence rules tuned for snappy commits without
  mid-word cuts; adjustable if users report early/late finalize.
