use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{InputCallbackInfo, StreamConfig};
use rubato::{FftFixedIn, Resampler};
use serde_json::json;
use tauri::{Emitter, Manager};
use whisper_rs::WhisperContextParameters;

/// `cpal::Stream` is `!Send`/`!Sync` on macOS (it wraps a CoreAudio object),
/// but it is safe to keep alive in a global as long as access is serialized.
/// We only touch it from the command thread while holding the runtime mutex.
/// The inner stream is never read directly — keeping the value alive is what
/// sustains the audio capture.
#[allow(dead_code)]
struct AudioStream(cpal::Stream);
unsafe impl Send for AudioStream {}
unsafe impl Sync for AudioStream {}

/// Target transcription sample rate (Hz) whisper expects.
const TARGET_SAMPLE_RATE: usize = 16_000;
/// Whisper needs at least ~1s of audio before a transcription is meaningful.
const MIN_TRANSCRIBE_SAMPLES: usize = TARGET_SAMPLE_RATE;
/// Minimum *new* audio since the last emit before we transcribe again, so we
/// don't re-run whisper on every tiny buffer.
const MIN_NEW_SAMPLES: usize = 8_000;
/// How often the worker loop wakes to transcribe buffered audio.
const WORKER_INTERVAL: Duration = Duration::from_millis(2_500);
/// Resampler nominal input frame size (before conversion to 16kHz). The real
/// chunk size is whatever `resampler.input_frames_next()` asks for.
const RESAMPLER_CHUNK: usize = 4_096;
/// Emit download progress roughly every 256KB.
const PROGRESS_STEP: u64 = 256 * 1_024;

struct VoiceRuntime {
    running: bool,
    stream: Option<AudioStream>,
    /// Raw mono f32 captured from the mic at the device sample rate.
    raw: Arc<std::sync::Mutex<Vec<f32>>>,
    /// Resampled 16kHz mono audio accumulated across the whole session.
    resampled: Vec<f32>,
    /// Tail of the last resample pass that didn't fill a full chunk yet.
    resample_leftover: Vec<f32>,
    /// How much of `resampled` we've already emitted as a partial.
    emitted_len: usize,
    cancel: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    context: Option<Arc<whisper_rs::WhisperContext>>,
    resampler: Option<FftFixedIn<f32>>,
    model: String,
    language: String,
    autopunctuate: bool,
}

impl Default for VoiceRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl VoiceRuntime {
    fn new() -> Self {
        VoiceRuntime {
            running: false,
            stream: None,
            raw: Arc::new(std::sync::Mutex::new(Vec::new())),
            resampled: Vec::new(),
            resample_leftover: Vec::new(),
            emitted_len: 0,
            cancel: Arc::new(AtomicBool::new(false)),
            worker: None,
            context: None,
            resampler: None,
            model: String::new(),
            language: String::new(),
            autopunctuate: false,
        }
    }
}

static RUNTIME: OnceLock<Arc<std::sync::Mutex<VoiceRuntime>>> = OnceLock::new();

fn runtime() -> Arc<std::sync::Mutex<VoiceRuntime>> {
    Arc::clone(RUNTIME.get_or_init(|| Arc::new(std::sync::Mutex::new(VoiceRuntime::new()))))
}

fn model_path(app: &tauri::AppHandle, model: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice")
        .join("models");
    Ok(dir.join(format!("ggml-{model}.bin")))
}

/// Transcribe a slice of 16kHz mono f32 samples.
fn transcribe(
    ctx: &whisper_rs::WhisperContext,
    samples: &[f32],
    language: &str,
    autopunctuate: bool,
) -> Result<String, String> {
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params =
        whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    if !language.is_empty() {
        params.set_language(Some(language));
    }
    if autopunctuate {
        params.set_initial_prompt("Add punctuation such as periods, commas, and question marks.");
    }
    state.full(params, samples).map_err(|e| e.to_string())?;
    let n = state.full_n_segments().map_err(|e| e.to_string())?;
    let mut text = String::new();
    for i in 0..n {
        text.push_str(&state.full_get_segment_text(i).map_err(|e| e.to_string())?);
        text.push(' ');
    }
    Ok(text)
}

/// Ensure the whisper model exists, downloading it from HuggingFace if needed.
/// Returns immediately; progress arrives via the `voice-stt-model` event.
#[tauri::command]
pub async fn voice_stt_ensure_model(
    window: tauri::WebviewWindow,
    model: String,
) -> Result<(), String> {
    let app = window.app_handle();
    let path = model_path(app, &model)?;

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

async fn download_model(
    window: &tauri::WebviewWindow,
    url: &str,
    path: &Path,
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

/// Start capturing microphone audio and continuously transcribing.
#[tauri::command]
pub fn voice_stt_start(
    window: tauri::WebviewWindow,
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

    // (Re)load the whisper context if needed.
    if guard.context.is_none() || guard.model != model {
        let path_str = path
            .to_str()
            .ok_or_else(|| "invalid model path".to_string())?;
        let ctx = whisper_rs::WhisperContext::new_with_params(
            path_str,
            WhisperContextParameters::default(),
        )
        .map_err(|e| e.to_string())
        .map(Arc::new)?;
        guard.context = Some(ctx);
        guard.model = model.clone();
    }

    // Set up the audio device + stream config. We explicitly require an f32
    // stream: the data callback below is `&[f32]`, and cpal only honors the
    // generic sample type when the chosen config supports it.
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no input device".to_string())?;
    let stream_config = f32_input_config(&device)?;
    let device_sample_rate = stream_config.sample_rate.0 as usize;
    let channels = stream_config.channels as usize;

    // Resampler device rate -> 16kHz mono (1 channel).
    let resampler = FftFixedIn::<f32>::new(
        device_sample_rate,
        TARGET_SAMPLE_RATE,
        RESAMPLER_CHUNK,
        2,
        1,
    )
    .map_err(|e| e.to_string())?;

    guard.resampler = Some(resampler);
    guard.raw = Arc::new(std::sync::Mutex::new(Vec::new()));
    guard.resampled.clear();
    guard.resample_leftover.clear();
    guard.emitted_len = 0;
    guard.cancel.store(false, Ordering::SeqCst);
    guard.language = language.clone();
    guard.autopunctuate = autopunctuate;

    let raw = Arc::clone(&guard.raw);
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

        if let Ok(mut cap) = raw.lock() {
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

    // Spawn the transcription worker thread.
    let rt_for_worker = Arc::clone(&rt);
    let worker_window = window.clone();
    guard.worker = Some(thread::spawn(move || {
        let rt = rt_for_worker;
        loop {
            thread::sleep(WORKER_INTERVAL);

            let (ctx, lang, autop) = {
                let g = rt.lock().unwrap();
                if g.cancel.load(Ordering::SeqCst) {
                    break;
                }
                match &g.context {
                    Some(c) => (Arc::clone(c), g.language.clone(), g.autopunctuate),
                    None => break,
                }
            };

            // Pull raw audio, resample it into the persistent 16kHz buffer,
            // and emit a cumulative partial whenever enough new audio arrived.
            let new_len = {
                let mut g = rt.lock().unwrap();
                let raw = {
                    let mut r = g.raw.lock().unwrap();
                    std::mem::take(&mut *r)
                };
                if !raw.is_empty() {
                    let mut p = std::mem::take(&mut g.resample_leftover);
                    p.extend(raw);
                    let mut out: Vec<f32> = Vec::new();
                    // Feed the resampler exactly what it asks for each pass.
                    // `input_frames_next()` can exceed RESAMPLER_CHUNK on the
                    // first call, so re-query it every iteration and keep any
                    // remainder for the next batch.
                    loop {
                        let need = g.resampler.as_ref().unwrap().input_frames_next();
                        if p.len() < need {
                            break;
                        }
                        let chunk: Vec<f32> = p.drain(..need).collect();
                        if let Ok(o) = g.resampler.as_mut().unwrap().process(&[chunk], None) {
                            out.extend_from_slice(&o[0]);
                        }
                    }
                    g.resample_leftover = p;
                    g.resampled.extend(out);
                }
                g.resampled.len()
            };

            if new_len >= MIN_TRANSCRIBE_SAMPLES && new_len - g_emitted_len(&rt) >= MIN_NEW_SAMPLES {
                let samples = {
                    let g = rt.lock().unwrap();
                    g.resampled.clone()
                };
                match transcribe(&ctx, &samples, &lang, autop) {
                    Ok(text) => {
                        let _ = worker_window
                            .emit("voice-stt-partial", json!({ "text": text.trim() }));
                        let mut g = rt.lock().unwrap();
                        g.emitted_len = new_len;
                    }
                    Err(e) => {
                        let _ = worker_window.emit(
                            "voice-stt-status",
                            json!({ "status": "error", "message": e }),
                        );
                    }
                }
            }
        }
    }));

    let _ = window.emit("voice-stt-status", json!({ "status": "listening" }));
    Ok(())
}

/// Read the `emitted_len` field without borrowing `ctx`.
fn g_emitted_len(rt: &Arc<std::sync::Mutex<VoiceRuntime>>) -> usize {
    rt.lock().unwrap().emitted_len
}

/// Pick a stream config whose sample format is f32, preferring the most
/// channels available. cpal infers the generic stream type from the data
/// callback; an f32 callback requires an f32-capable config or `build_input_stream`
/// fails.
fn f32_input_config(device: &cpal::Device) -> Result<StreamConfig, String> {
    let supported = device
        .supported_input_configs()
        .map_err(|e| e.to_string())?
        .filter(|c| c.sample_format() == cpal::SampleFormat::F32)
        .max_by(|a, b| a.channels().cmp(&b.channels()))
        .map(|c| c.with_max_sample_rate())
        .ok_or_else(|| "no f32-capable input config".to_string())?;
    Ok(supported.into())
}

/// Stop capturing and emit the final transcript.
#[tauri::command]
pub fn voice_stt_stop(window: tauri::WebviewWindow) -> Result<(), String> {
    let rt = runtime();
    let (samples, ctx, language, autopunctuate) = {
        let mut g = rt.lock().unwrap();
        if !g.running {
            return Ok(());
        }
        g.cancel.store(true, Ordering::SeqCst);
        // Drop the stream (cpal stops on drop) and join the worker.
        g.stream.take();
        if let Some(handle) = g.worker.take() {
            let _ = handle.join();
        }

        let samples = std::mem::take(&mut g.resampled);
        let ctx = g.context.clone();
        let language = g.language.clone();
        let autopunctuate = g.autopunctuate;

        g.running = false;
        (samples, ctx, language, autopunctuate)
    };

    if let Some(ctx) = ctx.as_ref() {
        if !samples.is_empty() {
            match transcribe(ctx, &samples, &language, autopunctuate) {
                Ok(text) => {
                    let _ = window.emit("voice-stt-final", json!({ "text": text.trim() }));
                }
                Err(e) => {
                    let _ = window.emit(
                        "voice-stt-status",
                        json!({ "status": "error", "message": e }),
                    );
                }
            }
        }
    }

    let _ = window.emit("voice-stt-status", json!({ "status": "idle" }));
    Ok(())
}
