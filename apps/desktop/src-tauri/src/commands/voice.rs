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
/// How often the worker loop wakes to transcribe buffered audio.
const WORKER_INTERVAL: Duration = Duration::from_millis(2_500);
/// Resampler input frame size (before conversion to 16kHz).
const RESAMPLER_CHUNK: usize = 4_096;
/// Emit download progress roughly every 256KB.
const PROGRESS_STEP: u64 = 256 * 1_024;

struct VoiceRuntime {
    running: bool,
    stream: Option<AudioStream>,
    captured: Arc<std::sync::Mutex<Vec<f32>>>,
    pending: Vec<f32>,
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
            captured: Arc::new(std::sync::Mutex::new(Vec::new())),
            pending: Vec::new(),
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
    let path = model_path(&app, &model)?;
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

    // Set up the audio device + stream config (f32 inferred from the callback).
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "no input device".to_string())?;
    let default_config = device.default_input_config().map_err(|e| e.to_string())?;
    let stream_config: StreamConfig = default_config.into();
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
    guard.pending.clear();
    guard.captured = Arc::new(std::sync::Mutex::new(Vec::new()));
    guard.cancel.store(false, Ordering::SeqCst);
    guard.language = language.clone();
    guard.autopunctuate = autopunctuate;

    let rt_for_stream = Arc::clone(&rt);
    let captured = Arc::clone(&guard.captured);
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

        // Move the captured mono samples into a local so we don't hold two
        // mutable borrows of the runtime guard at once (pending + resampler).
        let pending = {
            let mut g = match rt_for_stream.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            g.pending.extend_from_slice(&mono);
            std::mem::take(&mut g.pending)
        };

        // Resample the pending chunk(s) to 16kHz mono, then append to the
        // shared capture buffer.
        let mut collected: Vec<f32> = Vec::new();
        {
            let mut g = match rt_for_stream.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if let Some(resampler) = g.resampler.as_mut() {
                let need = resampler.input_frames_next();
                let mut p = pending;
                while p.len() >= need {
                    let chunk: Vec<f32> = p.drain(..need).collect();
                    if let Ok(out) = resampler.process(&[chunk], None) {
                        collected.extend_from_slice(&out[0]);
                    }
                }
            }
        }
        if let Ok(mut cap) = captured.lock() {
            cap.extend_from_slice(&collected);
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
            let samples = {
                let captured_arc = ctx_lock_captured(&rt);
                let mut cap = captured_arc.lock().unwrap();
                std::mem::take(&mut *cap)
            };
            if samples.len() > MIN_TRANSCRIBE_SAMPLES {
                match transcribe(&ctx, &samples, &lang, autop) {
                    Ok(text) => {
                        let _ =
                            worker_window.emit("voice-stt-partial", json!({ "text": text.trim() }));
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

fn ctx_lock_captured(rt: &Arc<std::sync::Mutex<VoiceRuntime>>) -> Arc<std::sync::Mutex<Vec<f32>>> {
    let g = rt.lock().unwrap();
    Arc::clone(&g.captured)
}

/// Stop capturing and emit the final transcript.
#[tauri::command]
pub fn voice_stt_stop(window: tauri::WebviewWindow) -> Result<(), String> {
    let rt = runtime();
    let (captured, ctx, language, autopunctuate) = {
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

        let captured = Arc::clone(&g.captured);
        let ctx = g.context.clone();
        let language = g.language.clone();
        let autopunctuate = g.autopunctuate;

        g.running = false;
        (captured, ctx, language, autopunctuate)
    };

    let samples = {
        let mut cap = captured.lock().unwrap();
        std::mem::take(&mut *cap)
    };

    if let Some(ctx) = ctx.as_ref() {
        if samples.len() > 0 {
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
