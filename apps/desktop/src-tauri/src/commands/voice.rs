// Voice dictation (STT) via whisper.cpp, driven locally on-device.
//
// Capture uses cpal (macOS only); audio is resampled to 16 kHz mono with rubato
// and fed to whisper-rs. For a smooth, real-time feel we do NOT re-transcribe
// overlapping sliding windows (that is slow and produces jittery half-words).
// Instead a lightweight energy-based voice-activity detector (VAD) segments the
// microphone stream into utterances: it waits for the speaker to pause, then
// transcribes that one complete utterance once and streams it to the document.
// This is both faster (each second of audio is decoded at most once) and far
// smoother (text lands in natural, whole phrases at pauses).
//
// A `voice-stt-level` event carries the live input amplitude so the UI can show
// an animated, voice-reactive indicator instead of a jittery text preview.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, InputCallbackInfo, SampleFormat, StreamConfig};
use rubato::{FftFixedIn, Resampler};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const TARGET_SAMPLE_RATE: usize = 16_000;
const RESAMPLER_CHUNK: usize = 8_192;
const PROGRESS_STEP: u64 = 256 * 1024;

/// How often the worker drains audio, runs the VAD, and emits a level. Short so
/// the animated indicator feels live and endpoints are detected promptly.
const WORKER_TICK: Duration = Duration::from_millis(80);
/// VAD analysis frame (30 ms @ 16 kHz).
const FRAME: usize = 480;
/// Trailing silence after speech that ends an utterance (~0.6 s pause).
const ENDPOINT_SILENCE_SAMPLES: usize = 9_600;
/// Minimum voiced audio for a segment to count as a real utterance (~0.2 s),
/// so coughs/clicks don't trigger a transcription.
const MIN_SPEECH_SAMPLES: usize = 3_200;
/// Force-flush a monologue this long even without a pause (~14 s).
const MAX_UTTERANCE_SAMPLES: usize = 14 * TARGET_SAMPLE_RATE;
/// Audio kept before the first voiced frame, so whisper has a little lead-in.
const PRE_PAD_SAMPLES: usize = 3_200; // 0.2 s
/// Whisper wants at least ~1 s of audio; shorter buffers are zero-padded.
const MIN_TRANSCRIBE_SAMPLES: usize = TARGET_SAMPLE_RATE;
/// Absolute floor for treating a frame as speech (guards near-silent rooms).
const MIN_VOICE_RMS: f32 = 0.012;
/// A frame is voiced when its RMS exceeds this multiple of the noise floor.
const VOICE_MULT: f32 = 2.2;

/// `cpal::Stream` is `!Send`/`!Sync` on macOS (it wraps a CoreAudio object),
/// but it is safe to keep alive in a global as long as access is serialized.
/// We only touch it from the command thread while holding the runtime mutex.
/// The inner stream is never read directly — keeping the value alive is what
/// sustains the audio capture.
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
    context: Option<Arc<WhisperContext>>,
    model: String,
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
            context: None,
            model: String::new(),
        }
    }
}

static RUNTIME: OnceLock<Arc<Mutex<VoiceRuntime>>> = OnceLock::new();

fn runtime() -> Arc<Mutex<VoiceRuntime>> {
    Arc::clone(RUNTIME.get_or_init(|| Arc::new(Mutex::new(VoiceRuntime::new()))))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn voice_stt_ensure_model(
    app: AppHandle,
    window: WebviewWindow,
    model: String,
) -> Result<(), String> {
    let path = model_path(&app, &model)?;

    if path.exists() {
        let _ = window.emit("voice-stt-model", json!({ "status": "ready" }));
        return Ok(());
    }

    std::fs::create_dir_all(path.parent().ok_or("invalid model path")?)
        .map_err(|e| e.to_string())?;

    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin");
    let win = window.clone();
    let dl_path = path.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = download_model(&win, &url, &dl_path).await {
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
    _model: String,
) -> Result<(), String> {
    Err("voice dictation is only available on macOS".into())
}

fn model_path(app: &AppHandle, model: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice")
        .join("models");
    Ok(dir.join(format!("ggml-{model}.bin")))
}

async fn download_model(
    window: &tauri::WebviewWindow,
    url: &str,
    path: &std::path::Path,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed with status {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
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

    let _ = window.emit("voice-stt-model", json!({ "status": "ready" }));
    Ok(())
}

/// Run a single whisper transcription over one complete utterance (16 kHz mono).
fn transcribe(
    ctx: &Arc<WhisperContext>,
    samples: &[f32],
    language: &str,
    autopunctuate: bool,
) -> Result<String, String> {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    if !language.is_empty() {
        params.set_language(Some(language));
    }
    // More decoder threads help on the 8-core M2 (encoder runs on the GPU).
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    params.set_n_threads(threads as i32);
    // Each utterance is decoded independently: greedy with a small temperature
    // fallback, no cross-utterance context (prevents hallucination carryover),
    // and the anti-hallucination thresholds. We allow multiple segments so long
    // utterances aren't truncated.
    params.set_temperature(0.0);
    params.set_temperature_inc(0.2);
    params.set_no_context(true);
    params.set_single_segment(false);
    params.set_suppress_blank(true);
    params.set_suppress_non_speech_tokens(true);
    if autopunctuate {
        params.set_initial_prompt("Add punctuation such as periods, commas, and question marks.");
    }

    // Whisper refuses inputs shorter than ~1 s; zero-pad so short utterances
    // still transcribe (and we avoid the "input is too short" spam).
    let padded: Vec<f32>;
    let audio: &[f32] = if samples.len() < MIN_TRANSCRIBE_SAMPLES {
        padded = {
            let mut v = Vec::with_capacity(MIN_TRANSCRIBE_SAMPLES);
            v.extend_from_slice(samples);
            v.resize(MIN_TRANSCRIBE_SAMPLES, 0.0);
            v
        };
        &padded
    } else {
        samples
    };

    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    state.full(params, audio).map_err(|e| e.to_string())?;

    let segments = state.full_n_segments().map_err(|e| e.to_string())?;
    let mut out = String::new();
    for i in 0..segments {
        let seg = state.full_get_segment_text(i).map_err(|e| e.to_string())?;
        out.push_str(seg.trim());
        out.push(' ');
    }
    Ok(out.trim().to_string())
}

fn rms_of(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|x| x * x).sum();
    (sum / samples.len() as f32).sqrt()
}

/// Whisper sometimes emits bracketed non-speech markers (e.g. "[BLANK_AUDIO]",
/// "(silence)") for near-silent input. Drop utterances that are only that.
fn is_noise_only(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return true;
    }
    let stripped: String = t
        .chars()
        .filter(|c| !matches!(c, '[' | ']' | '(' | ')' | '*' | '_' | ' ' | '.'))
        .collect();
    // Common markers whisper produces on silence.
    let lower = t.to_ascii_lowercase();
    stripped.is_empty()
        || lower.contains("blank_audio")
        || lower == "(silence)"
        || lower == "[silence]"
}

/// Voice-activity endpointer. Owned by the worker thread; segments the resampled
/// stream into utterances and holds the audio for the current one.
struct Endpointer {
    /// Resampled 16 kHz mono audio for the current (in-progress) utterance,
    /// including a short pre-pad of leading silence for context.
    buf: Vec<f32>,
    /// Samples already classified by the VAD (frame-aligned).
    analyzed: usize,
    /// Slow EMA of background noise, used as an adaptive speech threshold.
    noise_floor: f32,
    in_speech: bool,
    speech_samples: usize,
    silence_run: usize,
    /// Peak amplitude observed since the last level emit (drives the meter).
    peak_level: f32,
}

impl Endpointer {
    fn new() -> Self {
        Endpointer {
            buf: Vec::new(),
            analyzed: 0,
            noise_floor: 0.004,
            in_speech: false,
            speech_samples: 0,
            silence_run: 0,
            peak_level: 0.0,
        }
    }

    fn reset_utterance(&mut self) {
        self.buf.clear();
        self.analyzed = 0;
        self.in_speech = false;
        self.speech_samples = 0;
        self.silence_run = 0;
    }

    /// Feed newly resampled audio and update VAD state.
    fn push(&mut self, samples: &[f32]) {
        self.buf.extend_from_slice(samples);
        while self.analyzed + FRAME <= self.buf.len() {
            let frame = &self.buf[self.analyzed..self.analyzed + FRAME];
            let rms = rms_of(frame);
            if rms > self.peak_level {
                self.peak_level = rms;
            }
            let threshold = (self.noise_floor * VOICE_MULT).max(MIN_VOICE_RMS);
            if rms > threshold {
                self.in_speech = true;
                self.speech_samples += FRAME;
                self.silence_run = 0;
            } else {
                // Adapt the noise floor only while not clearly in speech.
                self.noise_floor = (self.noise_floor * 0.97 + rms * 0.03).clamp(0.0008, 0.05);
                if self.in_speech {
                    self.silence_run += FRAME;
                }
            }
            self.analyzed += FRAME;
        }

        // While we haven't heard speech yet, keep only a short pre-pad so the
        // buffer doesn't grow during long pre-speech silence.
        if !self.in_speech && self.buf.len() > PRE_PAD_SAMPLES {
            let drop = self.buf.len() - PRE_PAD_SAMPLES;
            self.buf.drain(0..drop);
            self.analyzed = self.analyzed.saturating_sub(drop);
        }
    }

    /// Returns true when the current utterance is complete and should be
    /// transcribed (a real pause, or the max length was reached).
    fn utterance_ready(&self) -> bool {
        self.in_speech
            && self.speech_samples >= MIN_SPEECH_SAMPLES
            && (self.silence_run >= ENDPOINT_SILENCE_SAMPLES
                || self.buf.len() >= MAX_UTTERANCE_SAMPLES)
    }

    /// Take the current level (0..1) and reset the peak for the next window.
    fn take_level(&mut self) -> f32 {
        // Perceptual-ish mapping: sqrt gives a livelier meter at low volumes.
        let level = (self.peak_level.sqrt() * 2.6).clamp(0.0, 1.0);
        self.peak_level = 0.0;
        level
    }
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

/// Worker thread body: capture → resample → VAD segment → transcribe → emit.
/// Everything slow happens here (never the UI thread), so the editor stays
/// responsive; on stop we do one final flush of any trailing speech.
#[allow(clippy::too_many_arguments)]
fn run_worker(
    rt: Arc<Mutex<VoiceRuntime>>,
    window: WebviewWindow,
    raw: Arc<Mutex<Vec<f32>>>,
    cancel: Arc<AtomicBool>,
    ctx: Arc<WhisperContext>,
    mut resampler: FftFixedIn<f32>,
    language: String,
    autopunctuate: bool,
    my_epoch: u64,
) {
    let debug = std::env::var("VOICE_STT_DEBUG").is_ok();
    let mut leftover: Vec<f32> = Vec::new();
    let mut ep = Endpointer::new();

    let still_mine = |rt: &Arc<Mutex<VoiceRuntime>>| -> bool {
        let g = rt.lock().unwrap();
        g.epoch == my_epoch
    };

    let emit_utterance = |ep: &mut Endpointer, rt: &Arc<Mutex<VoiceRuntime>>| {
        let audio = std::mem::take(&mut ep.buf);
        ep.reset_utterance();
        if audio.is_empty() {
            return;
        }
        match transcribe(&ctx, &audio, &language, autopunctuate) {
            Ok(text) => {
                if debug {
                    eprintln!("[voice-stt] utterance {} samples -> '{text}'", audio.len());
                }
                if !is_noise_only(&text) && still_mine(rt) {
                    let _ = window.emit("voice-stt-delta", json!({ "text": text }));
                }
            }
            Err(e) => {
                let _ = window.emit(
                    "voice-stt-status",
                    json!({ "status": "error", "message": e }),
                );
            }
        }
    };

    loop {
        thread::sleep(WORKER_TICK);
        if cancel.load(Ordering::SeqCst) || !still_mine(&rt) {
            break;
        }

        // 1. Drain captured audio and resample into 16 kHz mono.
        let captured = {
            let mut r = raw.lock().unwrap();
            std::mem::take(&mut *r)
        };
        if !captured.is_empty() {
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
            ep.push(&out);
        }

        // 2. Drive the animated indicator with the live input level.
        let level = ep.take_level();
        let _ = window.emit("voice-stt-level", json!({ "level": level }));

        // 3. Flush a complete utterance if the speaker paused.
        if ep.utterance_ready() {
            emit_utterance(&mut ep, &rt);
        }
    }

    // Final flush: transcribe any trailing speech captured before stop.
    if still_mine(&rt) && ep.in_speech && ep.speech_samples >= FRAME * 2 {
        emit_utterance(&mut ep, &rt);
    }
    if still_mine(&rt) {
        let _ = window.emit("voice-stt-status", json!({ "status": "idle" }));
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn voice_stt_start(
    window: WebviewWindow,
    model: String,
    language: String,
    autopunctuate: bool,
) -> Result<(), String> {
    let app = window.app_handle();
    let path = model_path(app, &model)?;
    if !path.exists() {
        return Err("model-not-ready".into());
    }

    let rt = runtime();
    let mut guard = rt.lock().unwrap();
    if guard.running {
        return Ok(());
    }

    // (Re)load the whisper context only when the model changed.
    if guard.context.is_none() || guard.model != model {
        let path_str = path
            .to_str()
            .ok_or_else(|| "invalid model path".to_string())?;
        let ctx_params = WhisperContextParameters {
            // Run the encoder on the Apple Metal GPU — the single biggest
            // speedup (CPU-only decoding is many times slower).
            use_gpu: true,
            ..Default::default()
        };
        let ctx = whisper_rs::WhisperContext::new_with_params(path_str, ctx_params)
            .map_err(|e| e.to_string())
            .map(Arc::new)?;
        guard.context = Some(ctx);
        guard.model = model.clone();
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
    guard.epoch = guard.epoch.wrapping_add(1);
    let my_epoch = guard.epoch;

    let ctx = Arc::clone(guard.context.as_ref().expect("context set above"));
    let rt_for_worker = Arc::clone(&rt);
    let worker_window = window.clone();
    guard.worker = Some(thread::spawn(move || {
        run_worker(
            rt_for_worker,
            worker_window,
            raw,
            cancel,
            ctx,
            resampler,
            language,
            autopunctuate,
            my_epoch,
        );
    }));

    let _ = window.emit("voice-stt-status", json!({ "status": "listening" }));
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn voice_stt_start(
    _window: WebviewWindow,
    _model: String,
    _language: String,
    _autopunctuate: bool,
) -> Result<(), String> {
    Err("voice dictation is only available on macOS".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn voice_stt_stop(_window: WebviewWindow) -> Result<(), String> {
    let rt = runtime();
    {
        let mut g = rt.lock().unwrap();
        if !g.running {
            return Ok(());
        }
        g.cancel.store(true, Ordering::SeqCst);
        // Dropping the stream stops capture immediately. We deliberately do NOT
        // join the worker here: it runs on its own thread, sees `cancel`, does
        // the final flush + emits `idle` there, then exits. Joining on this
        // (UI) thread would block the editor while a (possibly long) final
        // transcription runs, which is the freeze-on-stop bug.
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
