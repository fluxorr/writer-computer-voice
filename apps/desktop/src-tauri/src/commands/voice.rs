// Voice dictation (STT), running locally and offline on-device. Two engines:
//
//   - `sherpa` (default): sherpa-onnx, a C++ speech toolkit with safe Rust
//     bindings, driving NeMo Transducer models (Nemotron / Parakeet) two ways:
//       * true streaming models (Nemotron) go through the `OnlineRecognizer`,
//         which decodes one token per audio frame, so we get partial hypotheses
//         *while the user is still speaking* and only commit final text when the
//         utterance ends — the "Fluid" instantaneous feel;
//       * non-streaming Transducers (Parakeet TDT) lack the streaming metadata
//         the `OnlineRecognizer` needs, so they run through the
//         `OfflineRecognizer`: we buffer the utterance and decode it once speech
//         pauses. No live partials, but the same per-utterance commit UX.
//     Capture uses cpal; audio is resampled to 16 kHz mono with rubato and fed
//     to the model frame-by-frame on a worker thread.
//
//   - `apple-native`: Apple's on-device `SFSpeechRecognizer` fed by an
//     `AVAudioEngine` tap, via a small Objective-C bridge (`apple_speech.m`).
//     No model download; the OS ships the recognizer. The bridge streams the
//     full running transcript as partials and commits it once on stop.
//
// Both engines stream the same events:
//   - `voice-stt-partial` — the live, replaceable hypothesis (rendered as a
//     greyed overlay at the cursor in the editor).
//   - `voice-stt-final`  — the committed utterance (inserted into the doc on an
//     endpoint / when dictation stops).
//   - `voice-stt-level`  — the live input amplitude for the waveform indicator.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[cfg(target_os = "macos")]
use std::ffi::CStr;
#[cfg(target_os = "macos")]
use std::os::raw::{c_char, c_float, c_int, c_void};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, InputCallbackInfo, SampleFormat, StreamConfig};
use rubato::{FftFixedIn, Resampler};
use serde_json::json;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, OnlineRecognizer};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// Engine id for Apple's native on-device `SFSpeechRecognizer`. Any other value
/// (default) selects the sherpa-onnx engine.
const ENGINE_APPLE: &str = "apple-native";

const TARGET_SAMPLE_RATE: usize = 16_000;
const RESAMPLER_CHUNK: usize = 8_192;
/// How often the worker drains audio + decodes. Short so partial text feels
/// live; decode is cheap so this stays smooth.
const WORKER_TICK: Duration = Duration::from_millis(60);
const PROGRESS_STEP: u64 = 256 * 1024;

#[derive(Clone, Copy, Debug, PartialEq)]
enum ModelKind {
    Streaming,
    OfflineTransducer,
    MoonshineV2,
    SenseVoice,
}

/// Model registry: the Settings `voice.stt.model` id maps to a GitHub release
/// asset (from `k2-fsa/sherpa-onnx` `asr-models`).
struct ModelDef {
    archive: &'static str,
    url: &'static str,
    kind: ModelKind,
}

const MODELS: &[(&str, ModelDef)] = &[
    (
        "nemotron-streaming",
        ModelDef {
            archive: "sherpa-onnx-nemotron-speech-streaming-en-0.6b-int8-2026-01-14.tar.bz2",
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemotron-speech-streaming-en-0.6b-int8-2026-01-14.tar.bz2",
            kind: ModelKind::Streaming,
        },
    ),
    (
        "parakeet-tdt-v3",
        ModelDef {
            archive: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
            kind: ModelKind::OfflineTransducer,
        },
    ),
    (
        "moonshine-tiny",
        ModelDef {
            archive: "sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2",
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2",
            kind: ModelKind::MoonshineV2,
        },
    ),
    (
        "sense-voice",
        ModelDef {
            archive: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
            kind: ModelKind::SenseVoice,
        },
    ),
];

fn model_def(id: &str) -> Option<&'static ModelDef> {
    MODELS.iter().find(|(k, _)| *k == id).map(|(_, d)| d)
}

fn discover_moonshine_files(dir: &std::path::Path) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let mut enc = None;
    let mut dec = None;
    let mut tok = None;
    fn walk(
        d: &std::path::Path,
        enc: &mut Option<PathBuf>,
        dec: &mut Option<PathBuf>,
        tok: &mut Option<PathBuf>,
    ) {
        let Ok(entries) = std::fs::read_dir(d) else {
            return;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(&p, enc, dec, tok);
                continue;
            }
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let lower = name.to_ascii_lowercase();
            if lower == "tokens.txt" {
                *tok = Some(p.clone());
            } else if lower.contains("encoder")
                && (lower.ends_with(".onnx") || lower.ends_with(".ort"))
            {
                *enc = Some(p.clone());
            } else if lower.contains("decoder")
                && lower.contains("merged")
                && (lower.ends_with(".onnx") || lower.ends_with(".ort"))
            {
                *dec = Some(p.clone());
            }
        }
    }
    walk(dir, &mut enc, &mut dec, &mut tok);
    Some((enc?, dec?, tok?))
}

fn discover_sense_voice_files(dir: &std::path::Path) -> Option<(PathBuf, PathBuf)> {
    let mut model = None;
    let mut tok = None;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        if lower == "tokens.txt" {
            tok = Some(p.clone());
        } else if lower.contains("model.int8.onnx") || lower == "model.int8.onnx" {
            model = Some(p.clone());
        }
    }
    Some((model?, tok?))
}

/// `cpal::Stream` is `!Send`/`!Sync` on macOS (it wraps a CoreAudio object),
/// but it is safe to keep alive in a global as long as access is serialized.
/// We only touch it from the command thread while holding the runtime mutex;
/// the inner stream is never read directly — keeping the value alive sustains
/// capture.
#[allow(dead_code)]
struct AudioStream(cpal::Stream);
unsafe impl Send for AudioStream {}
unsafe impl Sync for AudioStream {}

struct VoiceRuntime {
    running: bool,
    stream: Option<AudioStream>,
    /// Raw mono f32 captured since the last tick (drained + resampled each tick).
    raw: Arc<Mutex<Vec<f32>>>,
    /// Bumped on every start so a detached/old worker can detect it no longer
    /// owns the session and must not emit text or status.
    epoch: u64,
    cancel: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    model: String,
    /// Present only while the Apple native engine is running. Holds the bridge
    /// handle and our leaked callback context, so `stop` can tear it down and
    /// reclaim the box.
    #[cfg(target_os = "macos")]
    apple: Option<AppleSession>,
}

impl VoiceRuntime {
    fn new() -> Self {
        VoiceRuntime {
            running: false,
            stream: None,
            raw: Arc::new(Mutex::new(Vec::new())),
            epoch: 0,
            cancel: Arc::new(AtomicBool::new(false)),
            worker: None,
            model: String::new(),
            #[cfg(target_os = "macos")]
            apple: None,
        }
    }
}

static RUNTIME: OnceLock<Arc<Mutex<VoiceRuntime>>> = OnceLock::new();

fn runtime() -> Arc<Mutex<VoiceRuntime>> {
    Arc::clone(RUNTIME.get_or_init(|| Arc::new(Mutex::new(VoiceRuntime::new()))))
}

// ---------- Apple native engine (SFSpeechRecognizer via ObjC bridge) ----------

#[cfg(target_os = "macos")]
mod apple_ffi {
    use std::os::raw::{c_char, c_float, c_int, c_void};
    extern "C" {
        pub fn apple_speech_request_authorization(
            ctx: *mut c_void,
            cb: extern "C" fn(*mut c_void, c_int, *const c_char),
        );
        pub fn apple_speech_start(
            ctx: *mut c_void,
            on_partial: extern "C" fn(*mut c_void, *const c_char),
            on_final: extern "C" fn(*mut c_void, *const c_char),
            on_error: extern "C" fn(*mut c_void, *const c_char),
            on_level: extern "C" fn(*mut c_void, c_float),
        ) -> *mut c_void;
        pub fn apple_speech_stop(handle: *mut c_void);
        pub fn apple_speech_abort();
    }
}

/// The context handed to the ObjC bridge as an opaque pointer. Bridge callbacks
/// borrow it (never take ownership) to emit events on the owning window; the
/// `epoch` lets a callback from a stale session be dropped.
#[cfg(target_os = "macos")]
struct AppleCtx {
    window: WebviewWindow,
    rt: Arc<Mutex<VoiceRuntime>>,
    epoch: u64,
}

/// A live Apple dictation session: `handle` is the bridge's opaque handle,
/// `ctx` is our leaked `AppleCtx` box (freed on normal stop). Raw pointers, so
/// we assert `Send` — access is serialized behind the runtime mutex.
#[cfg(target_os = "macos")]
struct AppleSession {
    handle: *mut c_void,
    ctx: *mut AppleCtx,
}
#[cfg(target_os = "macos")]
unsafe impl Send for AppleSession {}

#[cfg(target_os = "macos")]
unsafe fn apple_cstr(p: *const c_char) -> String {
    if p.is_null() {
        return String::new();
    }
    CStr::from_ptr(p).to_string_lossy().into_owned()
}

/// Borrow the `AppleCtx` from an opaque pointer, but only if it still owns the
/// current session (epoch match). Returns `None` for stale/invalid callbacks.
#[cfg(target_os = "macos")]
fn apple_ctx_if_current<'a>(ctx: *mut c_void) -> Option<&'a AppleCtx> {
    if ctx.is_null() {
        return None;
    }
    let c: &AppleCtx = unsafe { &*(ctx as *const AppleCtx) };
    let current = c.rt.lock().map(|g| g.epoch == c.epoch).unwrap_or(false);
    if current {
        Some(c)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
extern "C" fn apple_on_partial(ctx: *mut c_void, text: *const c_char) {
    if let Some(c) = apple_ctx_if_current(ctx) {
        let t = unsafe { apple_cstr(text) };
        let _ = c.window.emit("voice-stt-partial", json!({ "text": t }));
    }
}

#[cfg(target_os = "macos")]
extern "C" fn apple_on_final(ctx: *mut c_void, text: *const c_char) {
    // Not gated on `running` (fires during stop, once running is already false),
    // only on epoch, so the final always commits for the current session.
    if let Some(c) = apple_ctx_if_current(ctx) {
        let t = unsafe { apple_cstr(text) };
        if !t.trim().is_empty() {
            let _ = c.window.emit("voice-stt-final", json!({ "text": t }));
        }
    }
}

#[cfg(target_os = "macos")]
extern "C" fn apple_on_error(ctx: *mut c_void, text: *const c_char) {
    if let Some(c) = apple_ctx_if_current(ctx) {
        let msg = unsafe { apple_cstr(text) };
        // Stop the mic immediately (safe from inside the result handler) and
        // reset the runtime so a later start works. We deliberately leak this
        // (tiny) `AppleCtx` box rather than free it while still borrowing it.
        unsafe { apple_ffi::apple_speech_abort() };
        if let Ok(mut g) = c.rt.lock() {
            g.running = false;
            let _ = g.apple.take();
        }
        let _ = c.window.emit(
            "voice-stt-status",
            json!({ "status": "error", "message": msg }),
        );
    }
}

#[cfg(target_os = "macos")]
extern "C" fn apple_on_level(ctx: *mut c_void, level: c_float) {
    if let Some(c) = apple_ctx_if_current(ctx) {
        let l = (level * 2.6).clamp(0.0, 1.0);
        let _ = c.window.emit("voice-stt-level", json!({ "level": l }));
    }
}

#[cfg(target_os = "macos")]
extern "C" fn apple_auth_cb(ctx: *mut c_void, granted: c_int, err: *const c_char) {
    if ctx.is_null() {
        return;
    }
    // Reclaim the one-shot window box leaked in `apple_ensure`.
    let window = unsafe { Box::from_raw(ctx as *mut WebviewWindow) };
    if granted == 1 {
        let _ = window.emit("voice-stt-model", json!({ "status": "ready" }));
    } else {
        let msg = unsafe { apple_cstr(err) };
        let message = if msg.is_empty() {
            "speech recognition not authorized".to_string()
        } else {
            msg
        };
        let _ = window.emit(
            "voice-stt-model",
            json!({ "status": "error", "message": message }),
        );
    }
}

/// Request speech-recognition authorization, then emit `voice-stt-model`
/// ready/error. Mirrors the sherpa `ensure_model` flow (which downloads then
/// emits ready) so the frontend's start-after-ready path is engine-agnostic.
#[cfg(target_os = "macos")]
fn apple_ensure(window: WebviewWindow) {
    let ctx = Box::into_raw(Box::new(window)) as *mut c_void;
    unsafe { apple_ffi::apple_speech_request_authorization(ctx, apple_auth_cb) };
}

#[cfg(target_os = "macos")]
fn start_apple(window: WebviewWindow, model: String) -> Result<(), String> {
    let rt = runtime();
    let epoch = {
        let mut g = rt.lock().unwrap();
        if g.running {
            return Ok(());
        }
        g.running = true;
        g.model = model;
        g.epoch = g.epoch.wrapping_add(1);
        g.epoch
    };

    let ctx = Box::into_raw(Box::new(AppleCtx {
        window: window.clone(),
        rt: Arc::clone(&rt),
        epoch,
    }));

    // On failure the bridge invokes `on_error` synchronously (already emitted a
    // status), then returns null. The runtime lock is released above, so that
    // callback's epoch check won't deadlock.
    let handle = unsafe {
        apple_ffi::apple_speech_start(
            ctx as *mut c_void,
            apple_on_partial,
            apple_on_final,
            apple_on_error,
            apple_on_level,
        )
    };

    if handle.is_null() {
        unsafe { drop(Box::from_raw(ctx)) };
        if let Ok(mut g) = rt.lock() {
            g.running = false;
        }
        return Err("failed to start native dictation".into());
    }

    {
        let mut g = rt.lock().unwrap();
        g.apple = Some(AppleSession { handle, ctx });
    }
    let _ = window.emit("voice-stt-status", json!({ "status": "listening" }));
    Ok(())
}

/// Stop the Apple session: the bridge emits the final transcript synchronously,
/// then we free the callback context and emit `idle`. The runtime lock is held
/// only to take the session, never across the FFI call, so the `on_final`
/// callback's epoch check can't deadlock.
#[cfg(target_os = "macos")]
fn stop_apple(window: &WebviewWindow) {
    let rt = runtime();
    let session = {
        let mut g = rt.lock().unwrap();
        if !g.running {
            return;
        }
        g.running = false;
        g.apple.take()
    };
    if let Some(session) = session {
        unsafe {
            apple_ffi::apple_speech_stop(session.handle);
            drop(Box::from_raw(session.ctx));
        }
    }
    let _ = window.emit("voice-stt-status", json!({ "status": "idle" }));
}

fn model_dir(app: &AppHandle, model: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice")
        .join("models")
        .join(model);
    Ok(dir)
}

/// Recursively locate the model's four artifacts inside an extracted dir,
/// tolerant of the archive's internal folder layout / filename casing.
fn discover_model_files(dir: &std::path::Path) -> Option<(PathBuf, PathBuf, PathBuf, PathBuf)> {
    let mut enc = None;
    let mut dec = None;
    let mut join = None;
    let mut tok = None;
    fn walk(
        d: &std::path::Path,
        enc: &mut Option<PathBuf>,
        dec: &mut Option<PathBuf>,
        join: &mut Option<PathBuf>,
        tok: &mut Option<PathBuf>,
    ) {
        let Ok(entries) = std::fs::read_dir(d) else {
            return;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                walk(&p, enc, dec, join, tok);
            } else if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_ascii_lowercase();
                if lower == "tokens.txt" {
                    *tok = Some(p.clone());
                } else if lower.contains("encoder") && lower.ends_with(".onnx") {
                    *enc = Some(p.clone());
                } else if lower.contains("decoder") && lower.ends_with(".onnx") {
                    *dec = Some(p.clone());
                } else if lower.contains("joiner") && lower.ends_with(".onnx") {
                    *join = Some(p.clone());
                }
            }
        }
    }
    walk(dir, &mut enc, &mut dec, &mut join, &mut tok);
    Some((enc?, dec?, join?, tok?))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn voice_stt_ensure_model(
    app: AppHandle,
    window: WebviewWindow,
    engine: String,
    model: String,
) -> Result<(), String> {
    // The Apple native engine ships with the OS — no model to fetch. Requesting
    // authorization emits `voice-stt-model` ready/error, matching the sherpa
    // download flow so the frontend's start-after-ready path is shared.
    if engine == ENGINE_APPLE {
        apple_ensure(window);
        return Ok(());
    }

    let def = model_def(&model).ok_or_else(|| format!("unknown dictation model: {model}"))?;
    let dir = model_dir(&app, &model)?;

    if discover_model_files(&dir).is_some() {
        let _ = window.emit("voice-stt-model", json!({ "status": "ready" }));
        return Ok(());
    }

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let win = window.clone();
    let dl_dir = dir.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = download_and_extract(&win, def, &dl_dir).await {
            let _ = win.emit(
                "voice-stt-model",
                json!({ "status": "error", "message": err }),
            );
        }
    });

    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn voice_stt_ensure_model(
    _app: AppHandle,
    _window: WebviewWindow,
    _engine: String,
    _model: String,
) -> Result<(), String> {
    Err("voice dictation is only available on macOS".into())
}

async fn download_and_extract(
    window: &WebviewWindow,
    def: &ModelDef,
    dest_dir: &std::path::Path,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(def.url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "model download failed with status {}",
            resp.status()
        ));
    }
    let total = resp.content_length().unwrap_or(0);

    let tmp = dest_dir.join(format!("{}.downloading", def.archive));
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let prev = downloaded;
        downloaded += chunk.len() as u64;
        if downloaded / PROGRESS_STEP != prev / PROGRESS_STEP {
            let _ = window.emit(
                "voice-stt-model",
                json!({ "status": "downloading", "downloaded": downloaded, "total": total }),
            );
        }
    }
    drop(file);

    // Move the temp download to its final archive name, then extract.
    let archive_path = dest_dir.join(def.archive);
    std::fs::rename(&tmp, &archive_path).map_err(|e| e.to_string())?;

    let f = std::fs::File::open(&archive_path).map_err(|e| e.to_string())?;
    let decoder = bzip2::read::BzDecoder::new(f);
    let mut ar = tar::Archive::new(decoder);
    ar.unpack(dest_dir).map_err(|e| e.to_string())?;
    // The archive is large; drop it now that the .onnx files are extracted.
    let _ = std::fs::remove_file(&archive_path);

    if discover_model_files(dest_dir).is_none() {
        return Err("extracted model is missing expected .onnx/tokens files".into());
    }

    let _ = window.emit("voice-stt-model", json!({ "status": "ready" }));
    Ok(())
}

fn rms_of(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|x| x * x).sum();
    (sum / samples.len() as f32).sqrt()
}

/// Drain the shared capture buffer, resample to 16 kHz, and return the resampled
/// chunk plus the input RMS (for the level meter). `leftover` carries the
/// remainder that didn't fill a full resampler input frame between ticks.
fn drain_resample(
    raw: &Arc<Mutex<Vec<f32>>>,
    resampler: &mut FftFixedIn<f32>,
    leftover: &mut Vec<f32>,
) -> (Vec<f32>, f32) {
    let captured = {
        let mut r = raw.lock().unwrap();
        std::mem::take(&mut *r)
    };
    if captured.is_empty() {
        return (Vec::new(), 0.0);
    }
    let rms = rms_of(&captured);
    leftover.extend(captured);
    let mut out: Vec<f32> = Vec::new();
    loop {
        let need = resampler.input_frames_next();
        if leftover.len() < need {
            break;
        }
        let chunk: Vec<f32> = leftover.drain(..need).collect();
        if let Ok(o) = resampler.process(&[chunk], None) {
            out.extend_from_slice(&o[0]);
        }
    }
    (out, (rms * 2.6).clamp(0.0, 1.0))
}

/// Pick an f32-capable input config at the device's *default* sample rate
/// (preferring fewer channels). We deliberately avoid `with_max_sample_rate()`:
/// forcing the highest rate the device advertises can make cpal deliver a
/// stream whose real rate doesn't match the config, which silently yields
/// garbage samples.
fn f32_input_config(device: &Device) -> Result<StreamConfig, String> {
    let chosen = device
        .supported_input_configs()
        .map_err(|e| e.to_string())?
        .filter(|c| c.sample_format() == SampleFormat::F32)
        .min_by(|a, b| {
            a.channels()
                .cmp(&b.channels())
                .then(a.max_sample_rate().cmp(&b.max_sample_rate()))
        })
        .ok_or_else(|| "no f32-capable input config".to_string())?;

    let sr = device
        .default_input_config()
        .map(|d| d.sample_rate())
        .unwrap_or_else(|_| chosen.max_sample_rate());
    // `with_sample_rate` panics if the rate is outside the config's supported
    // range, so clamp to what this f32 config actually supports.
    let sr = sr.clamp(chosen.min_sample_rate(), chosen.max_sample_rate());

    Ok(chosen.with_sample_rate(sr).into())
}

/// Streaming worker body: capture → resample → `OnlineRecognizer` decode →
/// emit. Everything slow happens here (never the UI thread), so the editor
/// stays responsive. The recognizer + stream are created here (not moved from
/// the command thread) so we never rely on the recognizer being `Send`.
#[allow(clippy::too_many_arguments)]
fn run_streaming_worker(
    rt: Arc<Mutex<VoiceRuntime>>,
    window: WebviewWindow,
    raw: Arc<Mutex<Vec<f32>>>,
    cancel: Arc<AtomicBool>,
    files: (PathBuf, PathBuf, PathBuf, PathBuf),
    mut resampler: FftFixedIn<f32>,
    my_epoch: u64,
) {
    let debug = std::env::var("VOICE_STT_DEBUG").is_ok();

    let mut config = sherpa_onnx::OnlineRecognizerConfig::default();
    config.model_config.transducer.encoder = Some(files.0.to_string_lossy().into_owned());
    config.model_config.transducer.decoder = Some(files.1.to_string_lossy().into_owned());
    config.model_config.transducer.joiner = Some(files.2.to_string_lossy().into_owned());
    config.model_config.tokens = Some(files.3.to_string_lossy().into_owned());
    // NeMo Transducer family (RNN-T / TDT).
    config.model_config.model_type = Some("nemo_transducer".into());
    // CPU is plenty fast for these INT8 models on Apple Silicon; avoids GPU
    // provider setup and keeps latency predictable.
    config.model_config.provider = Some("cpu".into());
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    config.model_config.num_threads = threads as i32;
    config.enable_endpoint = true;
    config.decoding_method = Some("greedy_search".into());
    config.feat_config.sample_rate = 16_000;
    // Snappier commits: end an utterance after a short trailing silence so the
    // overlay finalizes without an awkward delay, but not mid-word.
    config.rule1_min_trailing_silence = 0.4;
    config.rule2_min_trailing_silence = 0.8;
    config.rule3_min_utterance_length = 0.8;

    let recognizer = match OnlineRecognizer::create(&config) {
        Some(r) => r,
        None => {
            let _ = window.emit(
                "voice-stt-status",
                json!({ "status": "error", "message": "failed to load speech model" }),
            );
            return;
        }
    };
    let stream = recognizer.create_stream();

    let still_mine = |rt: &Arc<Mutex<VoiceRuntime>>| -> bool {
        let g = rt.lock().unwrap();
        g.epoch == my_epoch
    };

    let mut leftover: Vec<f32> = Vec::new();
    let mut last_emitted = String::new();

    loop {
        thread::sleep(WORKER_TICK);
        if cancel.load(Ordering::SeqCst) || !still_mine(&rt) {
            break;
        }

        // 1. Drain captured audio, resample to 16 kHz, feed the model.
        let (out, level) = drain_resample(&raw, &mut resampler, &mut leftover);
        if !out.is_empty() {
            stream.accept_waveform(TARGET_SAMPLE_RATE as i32, &out);
        }

        // 2. Decode available frames and stream the live hypothesis.
        while recognizer.is_ready(&stream) {
            recognizer.decode(&stream);
            if let Some(result) = recognizer.get_result(&stream) {
                let t = result.text.trim().to_string();
                if !t.is_empty() && t != last_emitted {
                    last_emitted = t.clone();
                    if debug {
                        eprintln!("[voice-stt] partial: '{t}'");
                    }
                    let _ = window.emit("voice-stt-partial", json!({ "text": t }));
                }
            }

            // 3. Utterance ended: commit the final text and reset for the next.
            if recognizer.is_endpoint(&stream) {
                if let Some(result) = recognizer.get_result(&stream) {
                    let t = result.text.trim().to_string();
                    if !t.is_empty() {
                        if debug {
                            eprintln!("[voice-stt] final: '{t}'");
                        }
                        let _ = window.emit("voice-stt-final", json!({ "text": t }));
                    }
                }
                recognizer.reset(&stream);
                last_emitted.clear();
                // Clear the overlay now that the text is committed.
                let _ = window.emit("voice-stt-partial", json!({ "text": "" }));
            }
        }

        // 4. Drive the animated indicator with the live input level.
        let _ = window.emit("voice-stt-level", json!({ "level": level }));
    }

    // Final flush: feed a short tail of silence so any trailing frames decode,
    // then commit whatever is left (only if it differs from the last commit).
    if still_mine(&rt) {
        let pad = vec![0.0f32; TARGET_SAMPLE_RATE / 3]; // ~0.33 s
        stream.accept_waveform(TARGET_SAMPLE_RATE as i32, &pad);
        stream.input_finished();
        while recognizer.is_ready(&stream) {
            recognizer.decode(&stream);
            if let Some(result) = recognizer.get_result(&stream) {
                let t = result.text.trim().to_string();
                if !t.is_empty() && t != last_emitted {
                    let _ = window.emit("voice-stt-final", json!({ "text": t }));
                }
            }
        }
        let _ = window.emit("voice-stt-status", json!({ "status": "idle" }));
    }
}

/// Shared capture loop for all offline-only models. Buffers resampled audio,
/// decodes on silence detection, and flushes on stop.
fn run_offline_capture_loop(
    rt: Arc<Mutex<VoiceRuntime>>,
    window: WebviewWindow,
    raw: Arc<Mutex<Vec<f32>>>,
    cancel: Arc<AtomicBool>,
    recognizer: OfflineRecognizer,
    mut resampler: FftFixedIn<f32>,
    my_epoch: u64,
) {
    let debug = std::env::var("VOICE_STT_DEBUG").is_ok();

    let still_mine = |rt: &Arc<Mutex<VoiceRuntime>>| -> bool {
        let g = rt.lock().unwrap();
        g.epoch == my_epoch
    };

    let mut leftover: Vec<f32> = Vec::new();
    let mut buffer: Vec<f32> = Vec::new();
    let mut silence: usize = 0;
    const SILENCE_LIMIT: usize = (TARGET_SAMPLE_RATE as f32 * 0.7) as usize;

    loop {
        thread::sleep(WORKER_TICK);
        if cancel.load(Ordering::SeqCst) || !still_mine(&rt) {
            break;
        }

        let (out, level) = drain_resample(&raw, &mut resampler, &mut leftover);
        if !out.is_empty() {
            buffer.extend_from_slice(&out);
            if rms_of(&out) < 0.01 {
                silence += out.len();
            } else {
                silence = 0;
            }
        }

        if !buffer.is_empty() && silence >= SILENCE_LIMIT {
            run_offline_decode(&recognizer, &window, &buffer, debug);
            buffer.clear();
            silence = 0;
        }

        let _ = window.emit("voice-stt-level", json!({ "level": level }));
    }

    if still_mine(&rt) && !buffer.is_empty() {
        run_offline_decode(&recognizer, &window, &buffer, debug);
    }
    let _ = window.emit("voice-stt-status", json!({ "status": "idle" }));
}

/// Offline worker for NeMo Transducer models (e.g. Parakeet TDT).
fn run_offline_worker(
    rt: Arc<Mutex<VoiceRuntime>>,
    window: WebviewWindow,
    raw: Arc<Mutex<Vec<f32>>>,
    cancel: Arc<AtomicBool>,
    files: (PathBuf, PathBuf, PathBuf, PathBuf),
    resampler: FftFixedIn<f32>,
    my_epoch: u64,
) {
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer.encoder = Some(files.0.to_string_lossy().into_owned());
    config.model_config.transducer.decoder = Some(files.1.to_string_lossy().into_owned());
    config.model_config.transducer.joiner = Some(files.2.to_string_lossy().into_owned());
    config.model_config.tokens = Some(files.3.to_string_lossy().into_owned());
    config.model_config.model_type = Some("nemo_transducer".into());
    config.model_config.provider = Some("cpu".into());
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    config.model_config.num_threads = threads as i32;
    config.decoding_method = Some("greedy_search".into());
    config.feat_config.sample_rate = 16_000;

    let recognizer = match OfflineRecognizer::create(&config) {
        Some(r) => r,
        None => {
            let _ = window.emit(
                "voice-stt-status",
                json!({ "status": "error", "message": "failed to load speech model" }),
            );
            return;
        }
    };
    run_offline_capture_loop(rt, window, raw, cancel, recognizer, resampler, my_epoch);
}

/// Offline worker for Moonshine v2 models (encoder + merged_decoder).
fn run_moonshine_worker(
    rt: Arc<Mutex<VoiceRuntime>>,
    window: WebviewWindow,
    raw: Arc<Mutex<Vec<f32>>>,
    cancel: Arc<AtomicBool>,
    files: (PathBuf, PathBuf, PathBuf),
    resampler: FftFixedIn<f32>,
    my_epoch: u64,
) {
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.moonshine.encoder = Some(files.0.to_string_lossy().into_owned());
    config.model_config.moonshine.merged_decoder = Some(files.1.to_string_lossy().into_owned());
    config.model_config.tokens = Some(files.2.to_string_lossy().into_owned());
    config.model_config.model_type = Some("moonshine".into());
    config.model_config.provider = Some("cpu".into());
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    config.model_config.num_threads = threads as i32;
    config.decoding_method = Some("greedy_search".into());
    config.feat_config.sample_rate = 16_000;

    let recognizer = match OfflineRecognizer::create(&config) {
        Some(r) => r,
        None => {
            let _ = window.emit(
                "voice-stt-status",
                json!({ "status": "error", "message": "failed to load speech model" }),
            );
            return;
        }
    };
    run_offline_capture_loop(rt, window, raw, cancel, recognizer, resampler, my_epoch);
}

/// Offline worker for SenseVoice models (single model.onnx + tokens).
fn run_sense_voice_worker(
    rt: Arc<Mutex<VoiceRuntime>>,
    window: WebviewWindow,
    raw: Arc<Mutex<Vec<f32>>>,
    cancel: Arc<AtomicBool>,
    files: (PathBuf, PathBuf),
    resampler: FftFixedIn<f32>,
    my_epoch: u64,
) {
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.sense_voice.model = Some(files.0.to_string_lossy().into_owned());
    config.model_config.sense_voice.language = Some("auto".into());
    config.model_config.sense_voice.use_itn = true;
    config.model_config.tokens = Some(files.1.to_string_lossy().into_owned());
    config.model_config.model_type = Some("sense_voice".into());
    config.model_config.provider = Some("cpu".into());
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    config.model_config.num_threads = threads as i32;
    config.decoding_method = Some("greedy_search".into());
    config.feat_config.sample_rate = 16_000;

    let recognizer = match OfflineRecognizer::create(&config) {
        Some(r) => r,
        None => {
            let _ = window.emit(
                "voice-stt-status",
                json!({ "status": "error", "message": "failed to load speech model" }),
            );
            return;
        }
    };
    run_offline_capture_loop(rt, window, raw, cancel, recognizer, resampler, my_epoch);
}

/// Run one offline decode over a full utterance and emit the transcript.
fn run_offline_decode(
    recognizer: &OfflineRecognizer,
    window: &WebviewWindow,
    samples: &[f32],
    debug: bool,
) {
    let stream = recognizer.create_stream();
    stream.accept_waveform(TARGET_SAMPLE_RATE as i32, samples);
    recognizer.decode(&stream);
    if let Some(result) = stream.get_result() {
        let t = result.text.trim().to_string();
        if !t.is_empty() {
            if debug {
                eprintln!("[voice-stt] offline final: '{t}'");
            }
            let _ = window.emit("voice-stt-final", json!({ "text": t }));
        }
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn voice_stt_start(
    window: WebviewWindow,
    engine: String,
    model: String,
    _language: String,
    _autopunctuate: bool,
) -> Result<(), String> {
    // Apple native engine: no cpal/sherpa setup — the ObjC bridge owns capture.
    if engine == ENGINE_APPLE {
        return start_apple(window, model);
    }

    let def = model_def(&model).ok_or_else(|| format!("unknown dictation model: {model}"))?;
    let app = window.app_handle();
    let dir = model_dir(app, &model)?;
    // Validate model files exist (per-kind tuple type doesn't mix, so check
    // early but only capture the nemo tuple for streaming/offline workers).
    match def.kind {
        ModelKind::Streaming | ModelKind::OfflineTransducer => {
            discover_model_files(&dir).ok_or("model-not-ready".to_string())?;
        }
        ModelKind::MoonshineV2 => {
            discover_moonshine_files(&dir).ok_or("model-not-ready".to_string())?;
        }
        ModelKind::SenseVoice => {
            discover_sense_voice_files(&dir).ok_or("model-not-ready".to_string())?;
        }
    }
    let nemo_files = match def.kind {
        ModelKind::Streaming | ModelKind::OfflineTransducer => discover_model_files(&dir),
        _ => None,
    };

    let rt = runtime();
    let mut guard = rt.lock().unwrap();
    if guard.running {
        return Ok(());
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no input device".to_string())?;
    let stream_config = f32_input_config(&device)?;
    let device_sample_rate = stream_config.sample_rate.0 as usize;
    let channels = stream_config.channels as usize;

    let resampler = FftFixedIn::<f32>::new(
        device_sample_rate,
        TARGET_SAMPLE_RATE,
        RESAMPLER_CHUNK,
        2,
        1,
    )
    .map_err(|e| e.to_string())?;

    // Fresh capture buffer + a fresh cancel flag for this session, so a
    // detached previous worker can never be confused with this one.
    let raw = Arc::new(Mutex::new(Vec::new()));
    guard.raw = Arc::clone(&raw);
    let cancel = Arc::new(AtomicBool::new(false));
    guard.cancel = Arc::clone(&cancel);

    let capture_raw = Arc::clone(&raw);
    let data_callback = move |data: &[f32], _info: &InputCallbackInfo| {
        let channels = channels.max(1);
        let frames = data.len() / channels;
        let mut mono = Vec::with_capacity(frames);
        for i in 0..frames {
            let mut sum = 0.0f32;
            for c in 0..channels {
                sum += data[i * channels + c];
            }
            mono.push(sum / channels as f32);
        }
        if let Ok(mut cap) = capture_raw.lock() {
            cap.extend_from_slice(&mono);
        }
    };

    let error_callback = |err: cpal::StreamError| {
        eprintln!("voice-stt audio stream error: {err}");
    };

    let stream = device
        .build_input_stream(&stream_config, data_callback, error_callback, None)
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;

    guard.stream = Some(AudioStream(stream));
    guard.running = true;
    guard.model = model.clone();
    guard.epoch = guard.epoch.wrapping_add(1);
    let my_epoch = guard.epoch;

    let rt_for_worker = Arc::clone(&rt);
    let worker_window = window.clone();
    let kind = def.kind;
    // Pre-compute per-kind file tuples before the move closure.
    let moonshine_files = if kind == ModelKind::MoonshineV2 {
        discover_moonshine_files(&dir)
    } else {
        None
    };
    let sense_voice_files = if kind == ModelKind::SenseVoice {
        discover_sense_voice_files(&dir)
    } else {
        None
    };
    guard.worker = Some(thread::spawn(move || match kind {
        ModelKind::Streaming => run_streaming_worker(
            rt_for_worker,
            worker_window,
            raw,
            cancel,
            nemo_files.expect("files verified"),
            resampler,
            my_epoch,
        ),
        ModelKind::OfflineTransducer => run_offline_worker(
            rt_for_worker,
            worker_window,
            raw,
            cancel,
            nemo_files.expect("files verified"),
            resampler,
            my_epoch,
        ),
        ModelKind::MoonshineV2 => {
            let mf = moonshine_files.expect("moonshine files verified at start");
            run_moonshine_worker(
                rt_for_worker,
                worker_window,
                raw,
                cancel,
                mf,
                resampler,
                my_epoch,
            );
        }
        ModelKind::SenseVoice => {
            let svf = sense_voice_files.expect("sense-voice files verified at start");
            run_sense_voice_worker(
                rt_for_worker,
                worker_window,
                raw,
                cancel,
                svf,
                resampler,
                my_epoch,
            );
        }
    }));

    let _ = window.emit("voice-stt-status", json!({ "status": "listening" }));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn voice_stt_start(
    _window: WebviewWindow,
    _engine: String,
    _model: String,
    _language: String,
    _autopunctuate: bool,
) -> Result<(), String> {
    Err("voice dictation is only available on macOS".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn voice_stt_stop(window: WebviewWindow) -> Result<(), String> {
    let rt = runtime();
    // Apple native engine has no cpal stream / worker; tear it down separately.
    if rt.lock().unwrap().apple.is_some() {
        stop_apple(&window);
        return Ok(());
    }
    {
        let mut g = rt.lock().unwrap();
        if !g.running {
            return Ok(());
        }
        g.cancel.store(true, Ordering::SeqCst);
        // Dropping the stream stops capture immediately. We deliberately do NOT
        // join the worker here: it runs on its own thread, sees `cancel`, does
        // the final flush + emits `idle` there, then exits. Joining on this
        // (UI) thread would block the editor while the final decode runs.
        g.stream.take();
        g.running = false;
        let _ = g.worker.take(); // detach; the thread keeps running to completion
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn voice_stt_stop(_window: WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_def_returns_known_streaming() {
        let def = model_def("nemotron-streaming").unwrap();
        assert_eq!(def.kind, ModelKind::Streaming);
        assert!(def.archive.contains("nemotron"));
        assert!(def.url.starts_with("https://github.com/k2-fsa/"));
    }

    #[test]
    fn model_def_returns_known_offline_transducer() {
        let def = model_def("parakeet-tdt-v3").unwrap();
        assert_eq!(def.kind, ModelKind::OfflineTransducer);
    }

    #[test]
    fn model_def_returns_known_moonshine() {
        let def = model_def("moonshine-tiny").unwrap();
        assert_eq!(def.kind, ModelKind::MoonshineV2);
    }

    #[test]
    fn model_def_returns_known_sense_voice() {
        let def = model_def("sense-voice").unwrap();
        assert_eq!(def.kind, ModelKind::SenseVoice);
    }

    #[test]
    fn model_def_returns_none_for_unknown() {
        assert!(model_def("nonexistent-model").is_none());
    }

    #[test]
    fn model_kind_equality() {
        assert_eq!(ModelKind::Streaming, ModelKind::Streaming);
        assert_ne!(ModelKind::Streaming, ModelKind::OfflineTransducer);
        assert_ne!(ModelKind::MoonshineV2, ModelKind::SenseVoice);
    }

    #[test]
    fn discover_moonshine_files_finds_encoder_decoder_tokens() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("encoder.onnx"), b"").unwrap();
        std::fs::write(dir.path().join("decoder_merged.onnx"), b"").unwrap();
        std::fs::write(dir.path().join("tokens.txt"), b"").unwrap();

        let result = discover_moonshine_files(dir.path());
        assert!(result.is_some());
        let (enc, dec, tok) = result.unwrap();
        assert!(enc.to_string_lossy().contains("encoder"));
        assert!(dec.to_string_lossy().contains("merged"));
        assert!(tok.to_string_lossy().contains("tokens"));
    }

    #[test]
    fn discover_moonshine_files_returns_none_when_missing() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("unrelated.txt"), b"").unwrap();
        assert!(discover_moonshine_files(dir.path()).is_none());
    }

    #[test]
    fn discover_sense_voice_files_finds_model_and_tokens() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("model.int8.onnx"), b"").unwrap();
        std::fs::write(dir.path().join("tokens.txt"), b"").unwrap();

        let result = discover_sense_voice_files(dir.path());
        assert!(result.is_some());
        let (model, tok) = result.unwrap();
        assert!(model.to_string_lossy().contains("model.int8.onnx"));
        assert!(tok.to_string_lossy().contains("tokens"));
    }

    #[test]
    fn discover_sense_voice_files_returns_none_when_missing() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(discover_sense_voice_files(dir.path()).is_none());
    }

    #[test]
    fn discover_sense_voice_files_returns_none_for_empty_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir(dir.path().join("subdir")).unwrap();
        assert!(discover_sense_voice_files(dir.path()).is_none());
    }

    #[test]
    fn all_models_have_unique_ids() {
        let mut seen = std::collections::HashSet::new();
        for (id, _) in MODELS {
            assert!(seen.insert(id), "duplicate model id: {id}");
        }
    }

    #[test]
    fn all_model_urls_are_https_github() {
        for (id, def) in MODELS {
            assert!(
                def.url.starts_with("https://github.com/"),
                "model {id} URL is not an HTTPS GitHub URL: {}",
                def.url
            );
        }
    }
}
